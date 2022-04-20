/* global PathFinder Room RoomPosition FIND_STRUCTURES
STRUCTURE_KEEPER_LAIR STRUCTURE_CONTROLLER CONTROLLER_DOWNGRADE FIND_SOURCES
TERRAIN_MASK_WALL TERRAIN_MASK_SWAMP POWER_BANK_DECAY STRUCTURE_PORTAL
STRUCTURE_POWER_BANK FIND_MY_CONSTRUCTION_SITES STRUCTURE_STORAGE
STRUCTURE_TERMINAL FIND_RUINS STRUCTURE_INVADER_CORE EFFECT_COLLAPSE_TIMER */

import cache from 'utils/cache';
import hivemind from 'hivemind';
import interShard from 'intershard';
import NavMesh from 'utils/nav-mesh';
import utilities from 'utilities';
import {deserializeCoords, serializeCoords, serializePosition} from 'utils/serialization';
import {handleMapArea, markBuildings} from 'utils/cost-matrix';
import {packCoord, packCoordList, unpackCoordList, unpackCoordListAsPosList} from 'utils/packrat';

interface DepositInfo {
	x: number;
	y: number;
	id: Id<Deposit>;
	type: DepositConstant;
	decays: number;
	cooldown: number;
	freeTiles: number;
}

declare global {
	interface RoomMemory {
		abandonedResources?: Record<string, {
			[resourceType: string]: number;
		}>;
	}
}

export interface RoomIntelMemory {
	lastScan: number;
	exits: Partial<Record<ExitKey, string>>;
	rcl: number;
	ticksToDowngrade: number;
	ticksToNeutral: number;
	hasController: boolean;
	owner: string;
	reservation: {
		username: string;
		ticksToEnd: number;
	};
	sources: {
		x: number;
		y: number;
		id: Id<Source>;
		free: number;
	}[];
	mineralInfo: {
		x: number;
		y: number;
		id: Id<Mineral>;
		type: MineralConstant;
	};
	power: {
		amount: number;
		hits: number;
		decays: number;
		freeTiles: number;
		pos: string;
	};
	deposits?: DepositInfo[];
	structures: {
		[T in StructureConstant]?: {
			[id: string]: {
				x: number;
				y: number;
				hits: number;
				hitsMax: number;
			};
		};
	};
	terrain: {
		exit: number;
		wall: number;
		swamp: number;
		plain: number;
	};
	invaderInfo: {
		level: number;
		active: boolean;
		activates: number;
		collapses: number;
	};
	costPositions: [string, string];
	lastScout: number;
}

export default class RoomIntel {
	roomName: string;
	memory: RoomIntelMemory;
	newStatus: {
		[direction: string]: boolean;
	};
	otherSafeRooms: string[];
	otherUnsafeRooms: string[];
	joinedDirs: {
		[direction: string]: {
			[direction: string]: boolean;
		};
	};

	constructor(roomName) {
		this.roomName = roomName;

		const key = 'intel:' + roomName;
		if (!hivemind.segmentMemory.has(key)) {
			hivemind.segmentMemory.set(key, {});
		}

		this.memory = hivemind.segmentMemory.get(key);
	}

	/**
	 * Updates intel for a room.
	 */
	gatherIntel() {
		const room = Game.rooms[this.roomName];
		if (!room) return;

		const intel = this.memory;
		this.registerScoutAttempt();

		// @todo Have process logic handle throttling of this task.
		let lastScanThreshold = hivemind.settings.get('roomIntelCacheDuration');
		if (Game.cpu.bucket < 5000) {
			lastScanThreshold *= 5;
		}

		if (intel.lastScan && !hivemind.hasIntervalPassed(lastScanThreshold, intel.lastScan)) return;
		hivemind.log('intel', room.name).debug('Gathering intel after', intel.lastScan ? Game.time - intel.lastScan : 'infinite', 'ticks.');
		intel.lastScan = Game.time;

		this.gatherControllerIntel(room);
		this.gatherResourceIntel(room);
		this.gatherTerrainIntel();

		const structures: {
			[T in StructureConstant]?: Structure<T>[];
		} = _.groupBy(room.find(FIND_STRUCTURES), 'structureType');
		this.gatherPowerIntel(structures[STRUCTURE_POWER_BANK] as StructurePowerBank[]);
		this.getherDepositIntel();
		this.gatherPortalIntel(structures[STRUCTURE_PORTAL] as StructurePortal[]);
		this.gatherStructureIntel(structures, STRUCTURE_KEEPER_LAIR);
		this.gatherStructureIntel(structures, STRUCTURE_CONTROLLER);
		this.gatherInvaderIntel(structures);

		const ruins = room.find(FIND_RUINS);
		this.gatherAbandonedResourcesIntel(structures, ruins);

		// Remember room exits.
		this.memory.exits = Game.map.describeExits(room.name);

		// At the same time, create a PathFinder CostMatrix to use when pathfinding through this room.
		const constructionSites = _.groupBy(room.find(FIND_MY_CONSTRUCTION_SITES), 'structureType');
		this.generateCostMatrix(structures, constructionSites);

		// Update nav mesh for this room.
		const mesh = new NavMesh();
		mesh.generateForRoom(this.roomName);

		// @todo Check enemy structures.

		// @todo Maybe even have a modified military CostMatrix that can consider moving through enemy structures.
	}

	/**
	 * Commits controller status to memory.
	 *
	 * @param {Room} room
	 *   The room to gather controller intel on.
	 */
	gatherControllerIntel(room: Room) {
		this.memory.owner = null;
		this.memory.rcl = 0;
		this.memory.ticksToDowngrade = 0;
		this.memory.ticksToNeutral = 0;
		this.memory.hasController = typeof room.controller !== 'undefined';
		if (room.controller && room.controller.owner) {
			this.memory.owner = room.controller.owner.username;
			this.memory.rcl = room.controller.level;
			this.memory.ticksToDowngrade = room.controller.ticksToDowngrade;
			this.memory.ticksToNeutral = this.memory.ticksToDowngrade;
			for (let i = 1; i < this.memory.rcl; i++) {
				this.memory.ticksToNeutral += CONTROLLER_DOWNGRADE[i];
			}
		}

		this.memory.reservation = room.controller ? room.controller.reservation : {
			username: null,
			ticksToEnd: 0,
		};
	}

	/**
	 * Commits room resources to memory.
	 *
	 * @param {Room} room
	 *   The room to gather resource intel on.
	 */
	gatherResourceIntel(room: Room) {
		// Check sources.
		this.memory.sources = _.map(
			room.find(FIND_SOURCES),
			source => {
				return {
					x: source.pos.x,
					y: source.pos.y,
					id: source.id,
					free: source.getNumHarvestSpots(),
				};
			}
		);

		// Check minerals.
		this.memory.mineralInfo = room.mineral && {
			x: room.mineral.pos.x,
			y: room.mineral.pos.y,
			id: room.mineral.id,
			type: room.mineral.mineralType,
		};
	}

	/**
	 * Commits basic terrain metrics to memory.
	 */
	gatherTerrainIntel() {
		// Check terrain.
		this.memory.terrain = {
			exit: 0,
			wall: 0,
			swamp: 0,
			plain: 0,
		};
		const terrain = new Room.Terrain(this.roomName);
		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				const tileType = terrain.get(x, y);
				// Check border tiles.
				if (x === 0 || y === 0 || x === 49 || y === 49) {
					if (tileType !== TERRAIN_MASK_WALL) {
						this.memory.terrain.exit++;
					}

					continue;
				}

				// Check non-border tiles.
				switch (tileType) {
					case TERRAIN_MASK_WALL:
						this.memory.terrain.wall++;
						break;

					case TERRAIN_MASK_SWAMP:
						this.memory.terrain.swamp++;
						break;

					default:
						this.memory.terrain.plain++;
				}
			}
		}
	}

	/**
	 * Commits power bank status to memory.
	 *
	 * @param {Structure[]} powerBanks
	 *   An array containing all power banks for the room.
	 */
	gatherPowerIntel(powerBanks: StructurePowerBank[]) {
		delete this.memory.power;

		const powerBank: StructurePowerBank = _.first(powerBanks);
		if (!powerBank || powerBank.hits === 0 || powerBank.power === 0) return;

		// For now, send a notification!
		hivemind.log('intel', this.roomName).info('Power bank containing', powerBank.power, 'power found!');

		// Find out how many access points there are around this power bank.
		const terrain = new Room.Terrain(this.roomName);
		let numFreeTiles = 0;
		handleMapArea(powerBank.pos.x, powerBank.pos.y, (x, y) => {
			if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
				numFreeTiles++;
			}
		});

		this.memory.power = {
			amount: powerBank.power,
			hits: powerBank.hits,
			decays: Game.time + (powerBank.ticksToDecay || POWER_BANK_DECAY),
			freeTiles: numFreeTiles,
			pos: packCoord({x: powerBank.pos.x, y: powerBank.pos.y}),
		};

		// Also store room in strategy memory for easy access.
		if (Memory.strategy) {
			if (!Memory.strategy.power) {
				Memory.strategy.power = {rooms: {}};
			}

			if (!Memory.strategy.power.rooms) {
				Memory.strategy.power.rooms = {};
			}

			if (!Memory.strategy.power.rooms[this.roomName] || !Memory.strategy.power.rooms[this.roomName].isActive) {
				Memory.strategy.power.rooms[this.roomName] = this.memory.power;

				// @todo Update info when gathering is active.
			}
		}
	}

	getherDepositIntel() {
		delete this.memory.deposits;

		const room = Game.rooms[this.roomName];
		const deposits = room.find(FIND_DEPOSITS);
		const maxCooldown = hivemind.settings.get('maxDepositCooldown');
		if (deposits.length === 0) return;

		const terrain = new Room.Terrain(this.roomName);
		this.memory.deposits = [];
		for (const deposit of deposits) {
			if (!deposit || deposit.lastCooldown > maxCooldown) return;

			// For now, send a notification!
			hivemind.log('intel', this.roomName).info('Deposit containing', deposit.depositType, 'found!');

			// Find out how many access points there are around this power bank.
			let numFreeTiles = 0;
			handleMapArea(deposit.pos.x, deposit.pos.y, (x, y) => {
				if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
					numFreeTiles++;
				}
			});

			this.memory.deposits.push({
				x: deposit.pos.x,
				y: deposit.pos.y,
				id: deposit.id,
				type: deposit.depositType,
				decays: Game.time + deposit.ticksToDecay,
				cooldown: deposit.lastCooldown || 0,
				freeTiles: numFreeTiles,
			});

			// Also store room in strategy memory for easy access.
			if (Memory.strategy) {
				if (!Memory.strategy.deposits) {
					Memory.strategy.deposits = {rooms: {}};
				}

				if (!Memory.strategy.deposits.rooms) {
					Memory.strategy.deposits.rooms = {};
				}

				if (!Memory.strategy.deposits.rooms[this.roomName] || !Memory.strategy.deposits.rooms[this.roomName].isActive) {
					Memory.strategy.deposits.rooms[this.roomName] = {scouted: true};

					// @todo Update info when gathering is active.
				}
			}
		}
	}

	/**
	 * Commits portal status to memory.
	 *
	 * @param {Structure[]} portals
	 *   An array containing all power banks for the room.
	 */
	gatherPortalIntel(portals: StructurePortal[]) {
		for (const portal of portals || []) {
			// Ignore unstable portals for now.
			if (portal.ticksToDecay) continue;

			// Ignore same-shard portals for now.
			if (!('shard' in portal.destination)) continue;

			interShard.registerPortal(portal);
		}
	}

	/**
	 * Commits structure status to memory.
	 *
	 * @param {object} structures
	 *   An object containing Arrays of structures, keyed by structure type.
	 * @param {string} structureType
	 *   The type of structure to gather intel on.
	 */
	gatherStructureIntel(structures: {[structureType: string]: Structure[]}, structureType: StructureConstant) {
		if (!this.memory.structures) this.memory.structures = {};
		this.memory.structures[structureType] = {};
		for (const structure of structures[structureType] || []) {
			this.memory.structures[structureType][structure.id] = {
				x: structure.pos.x,
				y: structure.pos.y,
				hits: structure.hits,
				hitsMax: structure.hitsMax,
			};
		}
	}

	/**
	 * Commits abandoned resources to memory.
	 *
	 * @param {object} structures
	 *   An object containing Arrays of structures, keyed by structure type.
	 * @param {object[]} ruins
	 *   An array of Ruin objects.
	 */
	gatherAbandonedResourcesIntel(structures: {[structureType: string]: Structure[]}, ruins: Ruin[]) {
		// Find origin room.
		if (!Memory.strategy) return;
		if (!Memory.strategy.roomList) return;
		const strategyInfo = Memory.strategy.roomList[this.roomName];
		if (!strategyInfo || !strategyInfo.origin) return;

		const roomMemory = Memory.rooms[strategyInfo.origin];
		if (!roomMemory) return;

		if (!roomMemory.abandonedResources) roomMemory.abandonedResources = {};
		delete roomMemory.abandonedResources[this.roomName];

		if (this.memory.owner) return;
		if (!structures[STRUCTURE_STORAGE] && !structures[STRUCTURE_TERMINAL] && ruins.length === 0) return;

		const resources = {};
		const collections = [structures[STRUCTURE_STORAGE], structures[STRUCTURE_TERMINAL], ruins];
		_.each(collections, objects => {
			_.each(objects, object => {
				if (!object.store) return;

				_.each(object.store, (amount, resourceType) => {
					resources[resourceType] = (resources[resourceType] || 0) + amount;
				});
			});
		});

		if (_.keys(resources).length === 0) return;

		roomMemory.abandonedResources[this.roomName] = resources;

		// @todo Consider resources from buildings that might need dismantling first.

		// @todo Also consider saving containers with resources if it's not one
		// of our harvest rooms, so we can "borrow" from other players.
	}

	/**
	 * Commits info about invader outposts to memory.
	 *
	 * @param {object} structures
	 *   An object containing Arrays of structures, keyed by structure type.
	 */
	gatherInvaderIntel(structures) {
		delete this.memory.invaderInfo;

		const core: StructureInvaderCore = _.first(structures[STRUCTURE_INVADER_CORE]);
		if (!core) return;

		// Commit basic invader core info.
		this.memory.invaderInfo = {
			level: core.level,
			active: !core.ticksToDeploy,
			activates: core.ticksToDeploy ? Game.time + core.ticksToDeploy : undefined,
			collapses: null,
		};

		// Check when the core collapses.
		for (const effect of core.effects) {
			if (effect.effect === EFFECT_COLLAPSE_TIMER) {
				this.memory.invaderInfo.collapses = Game.time + effect.ticksRemaining;
			}
		}
	}

	/**
	 * Commits pathfinding matrix to memory.
	 *
	 * @param {object} structures
	 *   An object containing Arrays of structures, keyed by structure type.
	 * @param {object} constructionSites
	 *   An object containing Arrays of construction sites, keyed by structure type.
	 */
	generateCostMatrix(structures, constructionSites) {
		const obstaclePositions = this.generateObstacleList(this.roomName, structures, constructionSites);
		this.memory.costPositions = [
			packCoordList(_.map(obstaclePositions.obstacles, deserializeCoords)),
			packCoordList(_.map(obstaclePositions.roads, deserializeCoords)),
		];
	}

	/**
	 * Generates an obstacle list as an alternative to cost matrixes.
	 *
	 * @param {string} roomName
	 *   Name of the room to generate an obstacle list for.
	 * @param {object} structures
	 *   Arrays of structures to navigate around, keyed by structure type.
	 * @param {object} constructionSites
	 *   Arrays of construction sites to navigate around, keyed by structure type.
	 *
	 * @return {object}
	 *   An object containing encoded room positions in the following keys:
	 *   - obstacles: Any positions a creep cannot move through.
	 *   - roads: Any positions where a creep travels with road speed.
	 */
	generateObstacleList(roomName, structures, constructionSites) {
		const result = {
			obstacles: [],
			roads: [],
		};

		markBuildings(
			roomName,
			structures,
			constructionSites,
			structure => {
				const location = serializeCoords(structure.pos.x, structure.pos.y);
				if (!_.contains(result.obstacles, location)) {
					result.roads.push(location);
				}
			},
			structure => result.obstacles.push(serializePosition(structure.pos, roomName)),
			(x, y) => {
				const location = serializeCoords(x, y);
				if (!_.contains(result.obstacles, location)) {
					result.obstacles.push(location);
				}
			}
		);

		return result;
	}

	/**
	 * Gets coordinates of all known roads in the room.
	 */
	getRoadCoords(): {x: number, y: number}[] {
		if (!this.memory.costPositions) return [];

		return unpackCoordList(this.memory.costPositions[1]);
	}

	/**
	 * Returns number of ticks since intel on this room was last gathered.
	 *
	 * @return {number}
	 *   Number of ticks since intel was last gathered in this room.
	 */
	getAge(): number {
		return Game.time - (this.memory.lastScan || -100000);
	}

	/**
	 * Checks whether this room could be claimed by a player.
	 *
	 * @return {boolean}
	 *   True if the room has a controller.
	 */
	isClaimable(): boolean {
		if (this.memory.hasController) return true;

		return false;
	}

	/**
	 * Checks whether this room is claimed by another player.
	 *
	 * This checks ownership and reservations.
	 *
	 * @return {boolean}
	 *   True if the room is claimed by another player.
	 */
	isClaimed(): boolean {
		if (this.isOwned()) return true;
		if (this.memory.reservation && this.memory.reservation.username && this.memory.reservation.username !== utilities.getUsername()) return true;

		return false;
	}

	/**
	 * Gets info about a room's reservation status.
	 */
	getReservationStatus(): ReservationDefinition {
		return this.memory.reservation;
	}

	/**
	 * Checks if the room is owned by another player.
	 *
	 * @return {boolean}
	 *   True if the room is controlled by another player.
	 */
	isOwned(): boolean {
		if (!this.memory.owner) return false;
		if (this.memory.owner !== utilities.getUsername()) return true;

		return false;
	}

	getOwner(): string {
		return this.memory.owner;
	}

	/**
	 * Returns this room's last known rcl level.
	 *
	 * @return {number}
	 *   Controller level of this room.
	 */
	getRcl(): number {
		return this.memory.rcl || 0;
	}

	/**
	 * Returns position of energy sources in the room.
	 *
	 * @return {object[]}
	 *   An Array of ob objects containing id, x and y position of the source.
	 */
	getSourcePositions(): {x: number, y: number, id: Id<Source>, free: number}[] {
		return this.memory.sources || [];
	}

	/**
	 * Returns type of mineral source in the room, if available.
	 *
	 * @return {string}
	 *   Type of this room's mineral source.
	 */
	getMineralType(): string {
		return this.memory.mineralInfo ? this.memory.mineralInfo.type : null;
	}

	/**
	 * Returns position of mineral deposit in the room.
	 *
	 * @return {object}
	 *   An Object containing id, type, x and y position of the mineral deposit.
	 */
	getMineralPosition(): {x: number, y: number, id: Id<Mineral>, type: MineralConstant} {
		return this.memory.mineralInfo;
	}

	getDepositInfo(): DepositInfo[] {
		return this.memory.deposits;
	}

	/**
	 * Returns a cost matrix for the given room.
	 *
	 * @return {PathFinder.CostMatrix}
	 *   A cost matrix representing this room.
	 */
	getCostMatrix(): CostMatrix {
		let obstaclePositions;
		if (this.memory.costPositions) {
			obstaclePositions = {
				obstacles: unpackCoordListAsPosList(this.memory.costPositions[0], this.roomName),
				roads: unpackCoordListAsPosList(this.memory.costPositions[1], this.roomName),
			};
		}

		const matrix = new PathFinder.CostMatrix();
		if (obstaclePositions) {
			for (const pos of obstaclePositions.obstacles) {
				matrix.set(pos.x, pos.y, 0xFF);
			}

			for (const pos of obstaclePositions.roads) {
				if (matrix.get(pos.x, pos.y) === 0) {
					matrix.set(pos.x, pos.y, 1);
				}
			}
		}

		const lairs = this.getStructures(STRUCTURE_KEEPER_LAIR);
		if (lairs && _.size(lairs) > 0) {
			const terrain = new Room.Terrain(this.roomName);
			_.each(lairs, lair => {
				handleMapArea(lair.x, lair.y, (x, y) => {
					if (terrain.get(x, y) !== TERRAIN_MASK_WALL && matrix.get(x, y) < 10) matrix.set(x, y, 10);
				}, 3);
			});

			// Add area around sources as obstacles.
			_.each(this.getSourcePositions(), sourceInfo => {
				handleMapArea(sourceInfo.x, sourceInfo.y, (x, y) => {
					if (terrain.get(x, y) !== TERRAIN_MASK_WALL && matrix.get(x, y) < 10) matrix.set(x, y, 10);
				}, 4);
			});

			// Add area around mineral as obstacles.
			const mineralInfo = this.getMineralPosition();
			if (mineralInfo) {
				handleMapArea(mineralInfo.x, mineralInfo.y, (x, y) => {
					if (terrain.get(x, y) !== TERRAIN_MASK_WALL && matrix.get(x, y) < 10) matrix.set(x, y, 10);
				}, 4);
			}
		}

		return matrix;
	}

	/**
	 * Checks whether there is a previously generated cost matrix for this room.
	 *
	 * @return {bool}
	 *   Whether a cost matrix has previously been generated for this room.
	 */
	hasCostMatrixData(): boolean {
		if (this.memory.costPositions) return true;

		return false;
	}

	/**
	 * Returns a list of rooms connected to this one, keyed by direction.
	 *
	 * @return {object}
	 *   Exits as returned by Game.map.getExits().
	 */
	getExits = function (): Partial<Record<ExitKey, string>> {
		return this.memory.exits || {};
	}

	/**
	 * Returns position of the Controller structure in this room.
	 *
	 * @return {RoomPosition}
	 *   Position of this room's controller.
	 */
	getControllerPosition(): RoomPosition {
		if (!this.memory.structures || !this.memory.structures[STRUCTURE_CONTROLLER]) return null;

		const controller: {x: number, y: number} = _.sample(this.memory.structures[STRUCTURE_CONTROLLER]);
		return new RoomPosition(controller.x, controller.y, this.roomName);
	}

	/**
	 * Returns position and id of certain structures.
	 *
	 * @param {string} structureType
	 *   The type of structure to get info on.
	 *
	 * @return {object}
	 *   An object keyed by structure id. The stored objects contain the properties
	 *   x, y, hits and hitsMax.
	 */
	getStructures(structureType: StructureConstant): {[structureId: string]: {x: number, y: number, hits: number, hitsMax: number}} {
		if (!this.memory.structures || !this.memory.structures[structureType]) return {};
		return this.memory.structures[structureType];
	}

	/**
	 * Returns number of tiles of a certain type in a room.
	 *
	 * @param {string} type
	 *   Tile type. Can be one of `plain`, `swamp`, `wall` or `exit`.
	 *
	 * @return {number}
	 *   Number of tiles of the given type in this room.
	 */
	countTiles(type: string) {
		if (!this.memory.terrain) return 0;

		return this.memory.terrain[type] || 0;
	};

	/**
	 * Returns which exits of a room are considered safe.
	 *
	 * This is usually when they are dead ends or link up with other rooms
	 * owned by us that are sufficiently defensible.
	 *
	 * @param {object} options
	 *   Further options for calculation, possible keys are:
	 *   - safe: An array of room names which are considered safe no matter what.
	 *   - unsafe: An array of room names which are considered unsafe no matter what.
	 *
	 * @return {object}
	 *   An object describing adjacent room status, containing the following keys:
	 *   - directions: An object with keys N, E, S, W of booleans describing
	 *     whether that exit direction is considered safe.
	 *   - safeRooms: An array of room names that are considered safe and nearby.
	 */
	calculateAdjacentRoomSafety(options?: {safe?: string[], unsafe?: string[]}): {directions: {[dir: string]: boolean}; safeRooms: string[]} {
		return cache.inHeap('adjacentSafety:' + this.roomName, 100, () => {
			if (!this.memory.exits) {
				return {
					directions: {
						N: false,
						E: false,
						S: false,
						W: false,
					},
					safeRooms: [],
				};
			}

			const dirMap = {
				1: 'N',
				3: 'E',
				5: 'S',
				7: 'W',
			};

			this.newStatus = {
				N: true,
				E: true,
				S: true,
				W: true,
			};

			const openList = {};
			const closedList = {};
			this.joinedDirs = {};
			this.otherSafeRooms = options ? (options.safe || []) : [];
			this.otherUnsafeRooms = options ? (options.unsafe || []) : [];
			// Add initial directions to open list.
			for (const moveDir of _.keys(this.memory.exits)) {
				const dir = dirMap[moveDir];
				const roomName = this.memory.exits[moveDir];

				this.addAdjacentRoomToCheck(roomName, openList, {dir, range: 0});
			}

			// Process adjacent rooms until range has been reached.
			while (_.size(openList) > 0) {
				let minRange = null;
				for (const roomName in openList) {
					if (!minRange || minRange.range > openList[roomName].range) {
						minRange = openList[roomName];
					}
				}

				delete openList[minRange.room];
				closedList[minRange.room] = minRange;

				this.handleAdjacentRoom(minRange, openList, closedList);
			}

			// Unify status of directions which meet up somewhere.
			for (const dir1 of _.keys(this.joinedDirs)) {
				for (const dir2 of _.keys(this.joinedDirs[dir1])) {
					this.newStatus[dir1] = this.newStatus[dir1] && this.newStatus[dir2];
					this.newStatus[dir2] = this.newStatus[dir1] && this.newStatus[dir2];
				}
			}

			// Keep a list of rooms declared as safe in memory.
			const safeRooms = [];
			for (const roomName of _.keys(closedList)) {
				const roomDir = closedList[roomName].origin;
				if (this.newStatus[roomDir]) {
					safeRooms.push(roomName);
				}
			}

			return {
				directions: this.newStatus,
				safeRooms,
			};
		});
	}

	/**
	 * Adds a room to check for adjacent safe rooms.
	 *
	 * @param {string} roomName
	 *   Name of the room to add.
	 * @param {object} openList
	 *   List of rooms that still need checking.
	 * @param {object} base
	 *   Information about the room this operation is base on.
	 */
	addAdjacentRoomToCheck(roomName: string, openList, base) {
		if (!this.isPotentiallyUnsafeRoom(roomName)) return;

		openList[roomName] = {
			range: base.range + 1,
			origin: base.dir,
			room: roomName,
		};
	}

	isPotentiallyUnsafeRoom(roomName: string): boolean {
		if (this.otherUnsafeRooms.includes(roomName)) return true;
		if (this.otherSafeRooms.includes(roomName)) return false;

		if (Game.rooms[roomName] && Game.rooms[roomName].isMine()) {
			// This is one of our own rooms, and as such is possibly safe.
			if ((Game.rooms[roomName].controller.level >= Math.min(5, this.getRcl() - 1)) && !Game.rooms[roomName].isEvacuating()) return false;
			if (roomName === this.roomName) return false;
		}

		return true;
	}

	/**
	 * Check if a room counts as safe room.
	 *
	 * @param {object} roomData
	 *   Info about the room we're checking.
	 * @param {object} openList
	 *   List of rooms that still need checking.
	 * @param {object} closedList
	 *   List of rooms that have been checked.
	 */
	handleAdjacentRoom(roomData, openList, closedList) {
		const roomIntel = getRoomIntel(roomData.room);
		if (roomIntel.getAge() > 100000) {
			// Room has no intel, declare it as unsafe.
			this.newStatus[roomData.origin] = false;
			return;
		}

		// Add new adjacent rooms to openList if available.
		const roomExits = roomIntel.getExits();
		for (const roomName of _.values<string>(roomExits)) {
			if (roomData.range >= 3) {
				// Room has open exits more than 3 rooms away.
				// Mark direction as unsafe.
				this.newStatus[roomData.origin] = false;
				break;
			}

			const found = openList[roomName] || closedList[roomName];
			if (found) {
				if (found.origin !== roomData.origin) {
					// Two different exit directions are joined here.
					// Treat them as the same.
					if (!this.joinedDirs[found.origin]) {
						this.joinedDirs[found.origin] = {};
					}

					this.joinedDirs[found.origin][roomData.origin] = true;
				}

				continue;
			}

			this.addAdjacentRoomToCheck(roomName, openList, {roomData});
		}
	}

	/**
	 * Registers a scout attempting to reach this room.
	 */
	registerScoutAttempt() {
		this.memory.lastScout = Game.time;
	}

	/**
	 * Determiness the last time a scout was assigned to this room.
	 *
	 * @return {number}
	 *   Game tick when a scout attempt was last registered, or 0.
	 */
	getLastScoutAttempt(): number {
		return this.memory.lastScout || 0;
	}
}

const intelCache: {
  [roomName: string]: RoomIntel;
} = {};

/**
 * Factory method for room intel objects.
 *
 * @param {string} roomName
 *   The room for which to get intel.
 *
 * @return {RoomIntel}
 *   The requested RoomIntel object.
 */
function getRoomIntel(roomName: string): RoomIntel {
  if (!hivemind.segmentMemory.isReady()) throw new Error('Memory is not ready to generate room intel for room ' + roomName + '.');

  if (!intelCache[roomName]) {
    intelCache[roomName] = new RoomIntel(roomName);
  }

  return intelCache[roomName];
}

function getRoomsWithIntel(): string[] {
  const result: string[] = [];
  if (!hivemind.segmentMemory.isReady()) return result;

  hivemind.segmentMemory.each('intel:', (key) => {
    result.push(key.substr(6));
  });

  return result;
}

export {
  getRoomIntel,
  getRoomsWithIntel,
}
