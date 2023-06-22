/* global RoomPosition SOURCE_ENERGY_CAPACITY CARRY_CAPACITY
SOURCE_ENERGY_NEUTRAL_CAPACITY ENERGY_REGEN_TIME CONTROLLER_RESERVE_MAX
HARVEST_POWER LOOK_STRUCTURES STRUCTURE_CONTAINER */

declare global {
	interface RemoteMiningOperationMemory extends OperationMemory {
		type: 'mining';
		status: {
			[sourceLocation: string]: {
				containerId?: Id<StructureContainer>;
			}
		}
	}
}

import cache from 'utils/cache';
import HaulerRole from 'spawn-role/hauler';
import hivemind from 'hivemind';
import Operation from 'operation/operation';
import PathManager from 'remote-path-manager';
import {decodePosition, encodePosition} from 'utils/serialization';
import {getCostMatrix} from 'utils/cost-matrix';
import {getRoomIntel} from 'room-intel';
import {getUsername} from 'utils/account';
import {packPosList, unpackPosList} from 'utils/packrat';

/**
 * This kind of operation handles all remote mining.
 *
 * It determines source rooms for spawning and delivering resources.
 *
 * @todo Defend roads toward target room.
 * @todo Remove obstacles blocking paths (like old structures).
 * @todo Use dedicated builder creeps instead of haulers for road maintenance.
 */
export default class RemoteMiningOperation extends Operation {
	protected memory: RemoteMiningOperationMemory;
	protected pathManager: PathManager;
	protected haulerRole: HaulerRole;

	/**
	 * Constructs a new RemoteMiningOperation instance.
	 */
	public constructor(name: string) {
		super(name);
		this.memory.type = 'mining';
		this.pathManager = new PathManager();
		this.haulerRole = new HaulerRole();

		if (!this.memory.status) this.memory.status = {};
	}

	/**
	 * Acts on this operation being terminated.
	 *
	 * @todo Remove construction sites for this operation.
	 */
	onTerminate() {}

	/**
	 * Gets a list of active source positions keyed by room name.
	 */
	getMiningLocationsByRoom() {
		if (!hivemind.segmentMemory.isReady()) return {};

		return cache.inHeap('sourceRooms:' + this.name, 1000, () => {
			const result: {
				[roomName: string]: string[],
			} = {};
			const paths = this.getPaths();

			_.each(paths, (info, sourceLocation) => {
				if (!info.accessible) return;
				if (!result[info.sourceRoom]) result[info.sourceRoom] = [];

				result[info.sourceRoom].push(sourceLocation);
			});

			return result;
		});
	}

	/**
	 * Gets the position of all sources in the room.
	 */
	getSourcePositions(): RoomPosition[] {
		if (!hivemind.segmentMemory.isReady()) return [];

		const roomIntel = getRoomIntel(this.roomName);
		const sourceInfo = roomIntel.getSourcePositions();

		const positions: RoomPosition[] = [];
		for (const source of sourceInfo) {
			positions.push(new RoomPosition(source.x, source.y, this.roomName));
		}

		return positions;
	}

	/**
	 * Gets the room responsible for spawning creeps assigned to the given source.
	 */
	getSourceRoom(sourceLocation: string): string {
		const locations = this.getMiningLocationsByRoom();

		for (const roomName in locations) {
			if (locations[roomName].includes(sourceLocation)) return roomName;
		}

		return null;
	}

	/**
	 * Get best room to spawn claimers for this room.
	 *
	 * @todo Use room with higher rcl or spawn capacity.
	 */
	getClaimerSourceRoom() {
		return _.first(_.keys(this.getMiningLocationsByRoom()));
	}

	/**
	 * Gets the remote paths associated with this operation.
	 */
	getPaths() {
		return cache.inObject(this, 'getPaths', 0, () => {
			if (!hivemind.segmentMemory.isReady()) return {};

			const positions = this.getSourcePositions();
			const result: {
				[sourceLocation: string]: {
					accessible: boolean;
					path?: RoomPosition[];
					sourceRoom?: string;
					travelTime?: number;
					requiredCarryParts?: number;
					requiredWorkParts?: number;
				}
			} = {};
			for (const sourcePos of positions) {
				const sourceLocation = encodePosition(sourcePos);
				if (!this.memory.status[sourceLocation]) this.memory.status[sourceLocation] = {};

				// This has a short caching time since the path manager will do most of
				// the heavy caching. We also want to be able to react in changes
				// to room reservation somewhat quickly.
				const info = cache.inHeap('rmPath:' + sourceLocation, 100, () => {
					const path = this.pathManager.getPathFor(sourcePos);
					if (!path) {
						return {
							accessible: false,
						};
					}

					const sourceRoom = path[path.length - 1].roomName;
					const travelTime = path.length;
					const generatedEnergy = this.canReserveFrom(sourceRoom) ? SOURCE_ENERGY_CAPACITY : SOURCE_ENERGY_NEUTRAL_CAPACITY;
					const requiredWorkParts = generatedEnergy / ENERGY_REGEN_TIME / HARVEST_POWER;
					const requiredCarryParts = Math.ceil(2 * travelTime * generatedEnergy / ENERGY_REGEN_TIME / CARRY_CAPACITY);
					return {
						accessible: true,
						path: packPosList(path),
						sourceRoom,
						travelTime,
						requiredCarryParts,
						requiredWorkParts,
					};
				});

				if (info.accessible) {
					result[sourceLocation] = {
						accessible: info.accessible,
						path: unpackPosList(info.path),
						sourceRoom: info.sourceRoom,
						travelTime: info.travelTime,
						requiredCarryParts: info.requiredCarryParts,
						requiredWorkParts: info.requiredWorkParts,
					};
				}
				else {
					result[sourceLocation] = {
						accessible: info.accessible,
					};
				}
			}

			return result;
		});
	}

	/**
	 * Checks if the target room is under attack.
	 */
	isUnderAttack(): boolean {
		const roomMemory = Memory.rooms[this.roomName];
		if (roomMemory && roomMemory.enemies && !roomMemory.enemies.safe) return true;

		// Check rooms en route as well.
		return cache.inHeap('rmPathSafety:' + this.name, 10, () => {
			const paths = this.getPaths();
			const checkedRooms = {};
			for (const location in paths) {
				const path = paths[location];
				for (const pos of path.path || []) {
					if (pos.roomName === this.roomName) continue;
					if (checkedRooms[pos.roomName]) continue;

					checkedRooms[pos.roomName] = true;
					const roomMemory = Memory.rooms[pos.roomName];
					if (roomMemory && roomMemory.enemies && !roomMemory.enemies.safe) return true;
				}
			}

			return false;
		});
	}

	getTotalEnemyData(): EnemyData {
		const totalEnemyData: EnemyData = {
			parts: {},
			damage: 0,
			heal: 0,
			lastSeen: Game.time,
			safe: false,
		};

		for (const roomName of this.getRoomsOnPath()) {
			// @todo Now that we're spawning defense for every room on the path,
			// make sure brawlers actually move to threatened rooms.
			const roomMemory = Memory.rooms[roomName];
			if (!roomMemory || !roomMemory.enemies || roomMemory.enemies.safe) continue;

			totalEnemyData.damage += roomMemory.enemies.damage;
			totalEnemyData.heal += roomMemory.enemies.heal;
			for (const part in roomMemory.enemies.parts || {}) {
				totalEnemyData.parts[part] = (totalEnemyData.parts[part] || 0) + roomMemory.enemies.parts[part];
			}
		}

		return totalEnemyData;
	}

	estimateRequiredWorkPartsForMaintenance(sourceLocation: string) {
		return cache.inHeap('neededWorkParts:' + sourceLocation, 500, () => {
			let total = 1;

			const path = this.getPaths()[sourceLocation];
			for (const position of path.path || []) {
				if (Game.rooms[position.roomName]?.isMine()) continue;

				total += 0.05;
			}

			return Math.ceil(total);
		});
	}

	needsRepairs(sourceLocation: string) {
		return cache.inHeap('needsRepairs:' + sourceLocation, 50, () => {
			const containerPositon = this.getContainerPosition(sourceLocation);
			if (this.getNeededWorkForPosition(containerPositon, STRUCTURE_CONTAINER) > CONTAINER_HITS / 2) return true;

			const path = this.getPaths()[sourceLocation];
			for (const position of path.path || []) {
				if (Game.rooms[position.roomName]?.isMine()) continue;

				// @todo This should depend on whether it's a swamp tile.
				if (this.getNeededWorkForPosition(position, STRUCTURE_ROAD) > ROAD_HITS / 3) return true;
			}

			return false;
		});
	}

	getNeededWork(sourceLocation: string) {
		return cache.inHeap('neededRepairs:' + sourceLocation, 50, () => {
			const containerPositon = this.getContainerPosition(sourceLocation);
			let total = this.getNeededWorkForPosition(containerPositon, STRUCTURE_CONTAINER);

			const path = this.getPaths()[sourceLocation];
			for (const position of path.path || []) {
				if (Game.rooms[position.roomName]?.isMine()) continue;

				total += this.getNeededWorkForPosition(position, STRUCTURE_ROAD);
			}

			return total;
		});
	}

	getNeededWorkForPosition(position: RoomPosition, structureType: BuildableStructureConstant) {
		const room = Game.rooms[position.roomName];
		if (!room) {
			// If we don't have visibility, we treat everything as built.
			return 0;
		}

		const structures = position.lookFor(LOOK_STRUCTURES);
		const structure = _.filter(structures, structure => structure.structureType === structureType)[0];
		if (structure) return structure.hitsMax - structure.hits;

		const sites = position.lookFor(LOOK_STRUCTURES);
		const site = _.filter(sites, site => site.structureType === structureType)[0];
		if (site) return (site.hitsMax - site.hits) * REPAIR_POWER;

		return CONSTRUCTION_COST[structureType] * REPAIR_POWER;
	}

	getRoomsOnPath(sourceLocation?: string): string[] {
		return cache.inHeap('rmPath:' + this.name, 1000, () => {
			const paths = this.getPaths();
			const result: string[] = [];
			const checkedRooms = {};
			for (const location in paths) {
				if (sourceLocation && location !== sourceLocation) continue;

				const path = paths[location];
				for (const pos of path.path || []) {
					if (pos.roomName === this.roomName) continue;
					if (checkedRooms[pos.roomName]) continue;

					checkedRooms[pos.roomName] = true;
					result.push(pos.roomName);
				}
			}

			return result;
		});
	}

	canReserveFrom(roomName: string): boolean {
		if (!Game.rooms[roomName] || !Game.rooms[roomName].isMine()) return false;

		return Game.rooms[roomName].energyCapacityAvailable >= 2 * (BODYPART_COST[CLAIM] + BODYPART_COST[MOVE]);
	}

	/**
	 * Checks if we have an active reservation for the target room.
	 */
	hasReservation(): boolean {
		const room = Game.rooms[this.roomName];
		if (room) return room.controller.reservation && room.controller.reservation.username === getUsername() && room.controller.reservation.ticksToEnd >= CONTROLLER_RESERVE_MAX * 0.1;

		if (!hivemind.segmentMemory.isReady()) return false;
		const roomIntel = getRoomIntel(this.roomName);
		const reservation = roomIntel.getReservationStatus();
		return reservation && reservation.username === getUsername() && reservation.ticksToEnd >= CONTROLLER_RESERVE_MAX * 0.1;
	}

	/**
	 * Gets the container for the given source, if available.
	 */
	getContainer(sourceLocation: string): StructureContainer | null {
		if (!this.hasContainer(sourceLocation)) return null;
		if (!this.memory.status[sourceLocation]) return null;

		// Will return null if we don't have visibility in the target room.
		return Game.getObjectById<StructureContainer>(this.memory.status[sourceLocation].containerId);
	}

	/**
	 * Checks if a container has already been built near the given source.
	 *
	 * @todo We might have to build another container if the container position
	 * changes at some point.
	 */
	hasContainer(sourceLocation: string): boolean {
		return cache.inObject(this, 'hasContainer:' + sourceLocation, 0, () => {
			if (!this.memory.status[sourceLocation]) return false;

			if (!Game.rooms[this.roomName]) {
				return Boolean(this.memory.status[sourceLocation].containerId);
			}

			const containerId = this.memory.status[sourceLocation].containerId;
			if (containerId) {
				const container = Game.getObjectById<StructureContainer>(containerId);
				if (!container || container.structureType !== STRUCTURE_CONTAINER) {
					delete this.memory.status[sourceLocation].containerId;
					return false;
				}

				return true;
			}

			const containerPosition = this.getContainerPosition(sourceLocation);
			if (!containerPosition) return false;
			const structures = _.filter(containerPosition.lookFor(LOOK_STRUCTURES), (struct: AnyStructure) => struct.structureType === STRUCTURE_CONTAINER) as StructureContainer[];

			if (structures.length > 0) {
				this.memory.status[sourceLocation].containerId = structures[0].id;
				return true;
			}

			return false;
		});
	}

	/**
	 * Gets the position where the container for a source needs to be built.
	 */
	getContainerPosition(sourceLocation: string): RoomPosition {
		const paths = this.getPaths();
		if (!paths[sourceLocation] || !paths[sourceLocation].accessible) return null;

		return paths[sourceLocation].path[0];
	}

	getEnergyForPickup(sourceLocation: string): number {
		// @todo Keep track of available energy even if we lose visibility of the room.
		const container = this.getContainer(sourceLocation);
		let total = container?.store?.energy || 0;

		const position = decodePosition(sourceLocation);
		if (!Game.rooms[position.roomName]) return total;
		for (const resource of position.findInRange(FIND_DROPPED_RESOURCES, 1)) {
			if (resource.resourceType !== RESOURCE_ENERGY) continue;

			total =+ resource.amount;
		}

		return total;
	}

	/**
	 * Decides whether haulers need to be spawned for a location.
	 */
	shouldSpawnHaulers(sourceLocation: string): boolean {
		if (this.isUnderAttack()) return false;
		if (!this.hasContainer(sourceLocation)) return false;
		if (this.needsDismantler(sourceLocation)) return false;

		return true;
	}

	/**
	 * Determines the ideal size of harvesters for a source.
	 */
	getHarvesterSize(sourceLocation: string): number {
		// Make harvester slightly larger if container still needs to be built,
		// since we will spend some ticks building and not harvesting.
		const paths = this.getPaths();
		const multiplier = this.hasContainer(sourceLocation) ? 1 : 1.5;

		return paths[sourceLocation] && paths[sourceLocation].accessible ? paths[sourceLocation].requiredWorkParts * multiplier : 0;
	}

	/**
	 * Determines the ideal size of haulers for carrying the output of a source.
	 */
	getHaulerSize(sourceLocation: string): number {
		const paths = this.getPaths();

		if (!paths[sourceLocation]) return 0;
		if (!paths[sourceLocation].accessible) return 0;

		return paths[sourceLocation].requiredCarryParts;
	}

	/**
	 * Determines how many haulers of the given size should be spawned.
	 */
	getHaulerCount(): number {
		// @todo If a round trip is possible before container is full, use a single
		// big hauler.
		return this.hasReservation() ? 2 : 1;
	}

	/**
	 * Determines whether the source / room needs a dismantler.
	 */
	needsDismantler(sourceLocation?: string): boolean {
		if (!hivemind.segmentMemory.isReady()) return false;
		if (sourceLocation) return this.getDismantlePositions(sourceLocation).length > 0;

		for (const pos of this.getSourcePositions()) {
			if (this.needsDismantler(encodePosition(pos))) return true;
		}

		return false;
	}

	hasActiveHarvesters(sourceLocation?: string): boolean {
		if (sourceLocation) return _.filter(Game.creepsByRole['harvester.remote'], (creep: RemoteHarvesterCreep) => creep.memory.source === sourceLocation).length > 0;

		for (const pos of this.getSourcePositions()) {
			if (this.hasActiveHarvesters(encodePosition(pos))) return true;
		}

		return false;
	}

	/**
	 * Gets the positions on the remote path that are obstructed.
	 */
	getDismantlePositions(sourceLocation: string): RoomPosition[] {
		if (!hivemind.segmentMemory.isReady()) return [];

		const cached = cache.inHeap('blockedTiles:' + sourceLocation, 100, () => {
			const blockedTiles = [];
			const paths = this.getPaths();
			if (!paths[sourceLocation] || !paths[sourceLocation].accessible) return '';

			const path = paths[sourceLocation].path;
			let roomName;
			let matrix;
			// Check path from storage to source.
			for (let i = path.length - 1; i >= 0; i--) {
				const pos = path[i];
				if (pos.roomName !== roomName) {
					// Load cost matrix for the current room.
					roomName = pos.roomName;
					matrix = getCostMatrix(roomName);
				}

				// Don't try to dismantle things in our own rooms.
				if (Game.rooms[roomName] && Game.rooms[roomName].isMine()) continue;

				if (matrix.get(pos.x, pos.y) >= 100) {
					// Blocked tile found on path. Add to dismantle targets.
					blockedTiles.push(pos);
				}
			}

			return packPosList(blockedTiles);
		});

		return unpackPosList(cached);
	}

	needsBuilder(sourceLocation: string): boolean {
		if (!hivemind.segmentMemory.isReady()) return false;
		if (!this.hasContainer(sourceLocation)) return true;

		const container = this.getContainer(sourceLocation);
		if (container && container.hits < container.hitsMax / 3) return true;

		return cache.inHeap('needsBuilder:' + sourceLocation, 100, () => {
			const paths = this.getPaths();
			if (!paths[sourceLocation] || !paths[sourceLocation].accessible) return false;

			const path = paths[sourceLocation].path;
			// Check path from storage to source.
			for (let i = path.length - 1; i >= 0; i--) {
				const pos = path[i];
				if (!Game.rooms[pos.roomName] || Game.rooms[pos.roomName].isMine()) continue;

				const road = _.sample(_.filter(pos.lookFor(LOOK_STRUCTURES), s => s.structureType === STRUCTURE_ROAD));
				if (!road || road.hits < road.hitsMax / 5) return true;
			}

			return false;
		});
	}

	isProfitable(): boolean {
		return (this.getStat(RESOURCE_ENERGY) || 0) > 0;
	}

	drawReport(targetPos: string) {
		const requiredCarryParts = this.getHaulerSize(targetPos);

		// Determine how many haulers to spawn for this route.
		// If we cannot create big enough haulers (yet), create more of them!
		const spawnRoom = Game.rooms[this.getSourceRoom(targetPos)];
		if (!spawnRoom) return;

		const maximumBody = this.haulerRole.generateCreepBodyFromWeights(
			this.haulerRole.getBuilderBodyWeights(),
			spawnRoom.energyCapacityAvailable,
			{[CARRY]: requiredCarryParts},
		);
		const maxCarryPartsOnBiggestBody = _.countBy(maximumBody)[CARRY];
		const maxCarryPartsToEmptyContainer = Math.ceil(0.9 * CONTAINER_CAPACITY / CARRY_CAPACITY);
		const maxCarryParts = Math.min(maxCarryPartsOnBiggestBody, maxCarryPartsToEmptyContainer);
		const maxHaulers = Math.ceil(requiredCarryParts / maxCarryParts);
		const adjustedCarryParts = Math.ceil(requiredCarryParts / maxHaulers);

		const position = decodePosition(targetPos);
		const visual = new RoomVisual(position.roomName);
		visual.text('Requested carry parts: ' + requiredCarryParts, position.x, position.y, {align: 'left'});
		visual.text('Max parts per hauler: ' + maxCarryParts, position.x, position.y + 1, {align: 'left'});
		visual.text('Calculated hauler size: ' + adjustedCarryParts, position.x, position.y + 2, {align: 'left'});
		visual.text('Calculated hauler count: ' + maxHaulers, position.x, position.y + 3, {align: 'left'});

		const activeHaulers = _.filter(Game.creepsByRole.hauler, (creep: HaulerCreep) => creep.memory.source === targetPos);
		const activeCarryParts = _.sum(activeHaulers, creep => creep.getActiveBodyparts(CARRY));
		visual.text('Active haulers: ' + activeHaulers.length, position.x, position.y + 4.2, {align: 'left'});
		visual.text('Active carry parts: ' + activeCarryParts, position.x, position.y + 5.2, {align: 'left'});
	}
}
