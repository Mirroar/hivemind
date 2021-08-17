/* global hivemind RoomPosition SOURCE_ENERGY_CAPACITY CARRY_CAPACITY
SOURCE_ENERGY_NEUTRAL_CAPACITY ENERGY_REGEN_TIME CONTROLLER_RESERVE_MAX
HARVEST_POWER LOOK_STRUCTURES STRUCTURE_CONTAINER */

import hivemind from './hivemind';
import cache from './cache';
import Operation from './operation';
import * as packrat from './packrat';
import PathManager from './remote-path-manager';
import utilities from './utilities';

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

	pathManager: PathManager;

	/**
	 * Constructs a new RemoteMiningOperation instance.
	 */
	constructor(name) {
		super(name);
		this.memory.type = 'mining';
		this.pathManager = new PathManager();

		if (!this.memory.status) this.memory.status = {};
	}

	/**
	 * Acts on this operation being terminated.
	 *
	 * @todo Remove construction sites for this operation.
	 */
	onTerminate() {
	}

	/**
	 * Gets a list of active source positions keyed by room name.
	 */
	getMiningLocationsByRoom() {
		if (!hivemind.segmentMemory.isReady()) return {};

		return cache.inHeap('sourceRooms:' + this.name, 1000, () => {
			const result = {};
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
	getSourcePositions() {
		if (!hivemind.segmentMemory.isReady()) return [];

		const roomIntel = hivemind.roomIntel(this.roomName);
		const sourceInfo = roomIntel.getSourcePositions();

		const positions = [];
		for (const source of sourceInfo) {
			positions.push(new RoomPosition(source.x, source.y, this.roomName));
		}

		return positions;
	}

	/**
	 * Gets the room responsible for spawning creeps assigned to the given source.
	 */
	getSourceRoom(sourceLocation) {
		const locations = this.getMiningLocationsByRoom();

		for (const roomName in locations) {
			if (locations[roomName].indexOf(sourceLocation) !== -1) return roomName;
		}
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
		return cache.inObject(this, 0, 'getPaths', () => {
			if (!hivemind.segmentMemory.isReady()) return {};

			const positions = this.getSourcePositions();
			const result = {};
			for (const sourcePos of positions) {
				const sourceLocation = utilities.encodePosition(sourcePos);
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

					const travelTime = path.length;
					const energyCapacity = this.hasReservation() ? SOURCE_ENERGY_CAPACITY : SOURCE_ENERGY_NEUTRAL_CAPACITY;
					const requiredWorkParts = energyCapacity / ENERGY_REGEN_TIME / HARVEST_POWER;
					const requiredCarryParts = Math.ceil(travelTime * energyCapacity / ENERGY_REGEN_TIME / CARRY_CAPACITY);
					const sourceRoom = path[path.length - 1].roomName;
					return {
						accessible: true,
						path: packrat.packPosList(path),
						sourceRoom,
						travelTime,
						requiredCarryParts,
						requiredWorkParts,
					};
				});

				if (info.accessible) {
					result[sourceLocation] = {
						accessible: info.accessible,
						path: packrat.unpackPosList(info.path),
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
	 *
	 * @todo Check rooms en route as well.
	 */
	isUnderAttack() {
		const roomMemory = Memory.rooms[this.roomName];
		if (!roomMemory || !roomMemory.enemies) return false;
		if (roomMemory.enemies.safe) return false;

		return true;
	}

	/**
	 * Checks if we have an active reservation for the target room.
	 */
	hasReservation() {
		const room = Game.rooms[this.roomName];
		if (room) return room.controller.reservation && room.controller.reservation.username === utilities.getUsername() && room.controller.reservation.ticksToEnd >= CONTROLLER_RESERVE_MAX * 0.1;

		if (!hivemind.segmentMemory.isReady()) return false;
		const roomIntel = hivemind.roomIntel(this.roomName);
		const reservation = roomIntel.getReservationStatus();
		return reservation && reservation.username === utilities.getUsername() && reservation.ticksToEnd >= CONTROLLER_RESERVE_MAX * 0.1;
	}

	/**
	 * Gets the container for the given source, if available.
	 */
	getContainer(sourceLocation) {
		if (!this.hasContainer(sourceLocation)) return null;
		if (!this.memory.status[sourceLocation]) return null;

		// Will return null if we don't have visibility in the target room.
		return Game.getObjectById(this.memory.status[sourceLocation].containerId);
	}

	/**
	 * Checks if a container has already been built near the given source.
	 *
	 * @todo We might have to build another container if the container position
	 * changes at some point.
	 */
	hasContainer(sourceLocation) {
		return cache.inObject(this, 'hasContainer:' + sourceLocation, 0, () => {
			if (!this.memory.status[sourceLocation]) return false;

			if (!Game.rooms[this.roomName]) {
				return Boolean(this.memory.status[sourceLocation].containerId);
			}

			const containerId = this.memory.status[sourceLocation].containerId;
			if (containerId) {
				const container = Game.getObjectById(containerId);
				if (!container || container.structureType !== STRUCTURE_CONTAINER) {
					delete this.memory.status[sourceLocation].containerId;
					return false;
				}

				return true;
			}

			const containerPosition = this.getContainerPosition(sourceLocation);
			if (!containerPosition) return false;
			const structures = _.filter(containerPosition.lookFor(LOOK_STRUCTURES), struct => struct.structureType === STRUCTURE_CONTAINER);

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
	getContainerPosition(sourceLocation) {
		const paths = this.getPaths();
		if (!paths[sourceLocation] || !paths[sourceLocation].accessible) return;

		return paths[sourceLocation].path[0];
	}

	/**
	 * Decides whether haulers need to be spawned for a location.
	 */
	shouldSpawnHaulers(sourceLocation) {
		if (this.isUnderAttack()) return false;
		if (!this.hasContainer(sourceLocation)) return false;
		if (this.needsDismantler(sourceLocation)) return false;

		return true;
	}

	/**
	 * Determines the ideal size of harvesters for a source.
	 */
	getHarvesterSize(sourceLocation) {
		// Make harvester slightly larger if container still needs to be built,
		// since we will spend some ticks building and not harvesting.
		const paths = this.getPaths();
		const multiplier = this.hasContainer(sourceLocation) ? 1 : 1.5;

		return paths[sourceLocation] && paths[sourceLocation].accessible ? paths[sourceLocation].requiredWorkParts * multiplier : 0;
	}

	/**
	 * Determines the ideal size of haulers for carrying the output of a source.
	 */
	getHaulerSize(sourceLocation) {
		const paths = this.getPaths();

		return paths[sourceLocation] && paths[sourceLocation].accessible ? paths[sourceLocation].requiredCarryParts : 0;
	}

	/**
	 * Determines how many haulers of the given size should be spawned.
	 */
	getHaulerCount() {
		// @todo If a round trip is possible before container is full, use a single
		// big hauler.
		return this.hasReservation() ? 2 : 1;
	}

	/**
	 * Determines whether the source / room needs a dismantler.
	 */
	needsDismantler(sourceLocation) {
		if (!hivemind.segmentMemory.isReady()) return false;
		if (sourceLocation) return this.getDismantlePositions(sourceLocation).length > 0;

		let result = false;
		for (const pos of this.getSourcePositions()) {
			result |= this.needsDismantler(utilities.encodePosition(pos));
		}

		return result;
	}

	/**
	 * Gets the positions on the remote path that are obstructed.
	 */
	getDismantlePositions(sourceLocation) {
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
					matrix = utilities.getCostMatrix(roomName);
				}

				// Don't try to dismantle things in our own rooms.
				if (Game.rooms[roomName] && Game.rooms[roomName].isMine()) continue;

				if (matrix.get(pos.x, pos.y) >= 100) {
					// Blocked tile found on path. Add to dismantle targets.
					blockedTiles.push(pos);
				}
			}

			return packrat.packPosList(blockedTiles);
		});

		return packrat.unpackPosList(cached);
	}
};
