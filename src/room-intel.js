'use strict';

/* global hivemind PathFinder Room RoomPosition FIND_STRUCTURES LOOK_STRUCTURES
STRUCTURE_KEEPER_LAIR STRUCTURE_CONTROLLER CONTROLLER_DOWNGRADE FIND_SOURCES
TERRAIN_MASK_WALL TERRAIN_MASK_SWAMP POWER_BANK_DECAY STRUCTURE_PORTAL
STRUCTURE_POWER_BANK FIND_MY_CONSTRUCTION_SITES STRUCTURE_STORAGE
STRUCTURE_TERMINAL FIND_RUINS STRUCTURE_INVADER_CORE EFFECT_COLLAPSE_TIMER
FIND_SYMBOL_CONTAINERS FIND_SYMBOL_DECODERS STRUCTURE_WALL */

const interShard = require('./intershard');
const NavMesh = require('./nav-mesh');
const utilities = require('./utilities');

const RoomIntel = function (roomName) {
	this.roomName = roomName;

	if (!Memory.rooms[roomName]) {
		Memory.rooms[roomName] = {};
	}

	if (!Memory.rooms[roomName].intel) {
		Memory.rooms[roomName].intel = {};
	}

	this.memory = Memory.rooms[roomName].intel;
};

/**
 * Updates intel for a room.
 */
RoomIntel.prototype.gatherIntel = function () {
	const room = Game.rooms[this.roomName];
	if (!room) return;

	const intel = this.memory;
	this.registerScoutAttempt();

	// @todo Have process logic handle throttling of this task.
	let lastScanThreshold = 200;
	if (Game.cpu.bucket < 5000) {
		lastScanThreshold = 2500;
	}

	if (intel.lastScan && Game.time - intel.lastScan < lastScanThreshold * hivemind.getThrottleMultiplier()) return;
	hivemind.log('intel', room.name).debug('Gathering intel after', intel.lastScan ? Game.time - intel.lastScan : 'infinite', 'ticks.');
	intel.lastScan = Game.time;

	this.gatherControllerIntel(room);
	this.gatherResourceIntel(room);
	this.gatherSeasonIntel(room);
	this.gatherTerrainIntel();

	const structures = _.groupBy(room.find(FIND_STRUCTURES), 'structureType');
	this.gatherPowerIntel(structures[STRUCTURE_POWER_BANK]);
	this.gatherPortalIntel(structures[STRUCTURE_PORTAL]);
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
	this.generateWallBreakerCostMatrix(room);
};

/**
 * Commits controller status to memory.
 *
 * @param {Room} room
 *   The room to gather controller intel on.
 */
RoomIntel.prototype.gatherControllerIntel = function (room) {
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
};

/**
 * Commits room resources to memory.
 *
 * @param {Room} room
 *   The room to gather resource intel on.
 */
RoomIntel.prototype.gatherResourceIntel = function (room) {
	// Check sources.
	this.memory.sources = _.map(
		room.find(FIND_SOURCES),
		source => {
			return {
				x: source.pos.x,
				y: source.pos.y,
				id: source.id,
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
};

/**
 * Commits season-specific intel to memory.
 *
 * @param {Room} room
 *   The room to gather season intel on.
 */
RoomIntel.prototype.gatherSeasonIntel = function (room) {
	const containers = room.find(FIND_SYMBOL_CONTAINERS);
	const decoder = _.first(room.find(FIND_SYMBOL_DECODERS));

	this.memory.symbolDecoder = decoder && {
		symbol: decoder.resourceType,
		x: decoder.pos.x,
		y: decoder.pos.y,
		id: decoder.id,
	};

	delete this.memory.symbolContainers;
	if (containers.length === 0) return;

	this.memory.symbolContainers = [];
	for (const container of containers) {
		this.memory.symbolContainers.push({
			symbol: container.resourceType,
			x: container.pos.x,
			y: container.pos.y,
			id: container.id,
			amount: container.store[container.resourceType] || 0,
			decays: container.ticksToDecay + Game.time,
		});
	}
};

/**
 * Commits basic terrain metrics to memory.
 */
RoomIntel.prototype.gatherTerrainIntel = function () {
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
};

/**
 * Commits power bank status to memory.
 *
 * @param {Structure[]} powerBanks
 *   An array containing all power banks for the room.
 */
RoomIntel.prototype.gatherPowerIntel = function (powerBanks) {
	delete this.memory.power;
	return;

	const powerBank = _.first(powerBanks);
	if (!powerBank || powerBank.hits === 0 || powerBank.power === 0) return;

	// For now, send a notification!
	hivemind.log('intel', this.roomName).info('Power bank containing', powerBank.amount, 'power found!');

	// Find out how many access points there are around this power bank.
	const terrain = new Room.Terrain(this.roomName);
	let numFreeTiles = 0;
	utilities.handleMapArea(powerBank.pos.x, powerBank.pos.y, (x, y) => {
		if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
			numFreeTiles++;
		}
	});

	this.memory.power = {
		amount: powerBank.power,
		hits: powerBank.hits,
		decays: Game.time + (powerBank.ticksToDecay || POWER_BANK_DECAY),
		freeTiles: numFreeTiles,
	};

	// Also store room in strategy memory for easy access.
	if (Memory.strategy) {
		if (!Memory.strategy.power) {
			Memory.strategy.power = {};
		}

		if (!Memory.strategy.power.rooms) {
			Memory.strategy.power.rooms = {};
		}

		if (!Memory.strategy.power.rooms[this.roomName] || !Memory.strategy.power.rooms[this.roomName].isActive) {
			Memory.strategy.power.rooms[this.roomName] = this.memory.power;
		}
	}
};

/**
 * Commits portal status to memory.
 *
 * @param {Structure[]} portals
 *   An array containing all power banks for the room.
 */
RoomIntel.prototype.gatherPortalIntel = function (portals) {
	for (const portal of portals || []) {
		// Ignore unstable portals for now.
		if (portal.ticksToDecay) continue;

		// Ignore same-shard portals for now.
		if (!portal.destination.shard) continue;

		interShard.registerPortal(portal);
	}
};

/**
 * Commits structure status to memory.
 *
 * @param {object} structures
 *   An object containing Arrays of structures, keyed by structure type.
 * @param {string} structureType
 *   The type of structure to gather intel on.
 */
RoomIntel.prototype.gatherStructureIntel = function (structures, structureType) {
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
};

/**
 * Commits abandoned resources to memory.
 *
 * @param {object} structures
 *   An object containing Arrays of structures, keyed by structure type.
 * @param {object[]} ruins
 *   An array of Ruin objects.
 */
RoomIntel.prototype.gatherAbandonedResourcesIntel = function (structures, ruins) {
	delete this.memory.abandonedResources;

	// Resources in owned rooms are not considered abandoned.
	if (this.isOwned()) return;

	// Find origin room.
	if (!Memory.strategy) return;
	if (!Memory.strategy.roomList) return;
	const strategyInfo = Memory.strategy.roomList[this.roomName];
	if (!strategyInfo || !strategyInfo.origin) return;

	const roomMemory = Memory.rooms[strategyInfo.origin];
	if (!roomMemory.abandonedResources) roomMemory.abandonedResources = {};
	delete roomMemory.abandonedResources[this.roomName];

	if (this.memory.owner) return;

	if (!structures[STRUCTURE_STORAGE] && !structures[STRUCTURE_TERMINAL] && ruins.length === 0 && !this.memory.symbolContainers) return;

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

	_.each(this.memory.symbolContainers, containerIntel => {
		resources[containerIntel.symbol] = (resources[containerIntel.symbol] || 0) + containerIntel.amount;
	});

	if (_.keys(resources).length === 0) return;

	roomMemory.abandonedResources[this.roomName] = resources;

	const numSymbols = _.sum(_.filter(resources, (a, r) => _.includes(SYMBOLS, r)));
	const assignedGatherers = _.filter(Game.creepsByRole.gatherer || {}, creep => creep.memory.targetRoom === this.roomName);
	let assignedSpace = _.sum(_.map(assignedGatherers, creep => creep.store.getCapacity()));
	const availableGatherers = _.filter(
		Game.creepsByRole.gatherer,
		creep => !creep.memory.targetRoom &&
			Game.map.getRoomLinearDistance(creep.room.name, this.roomName) <= 5 &&
			creep.ticksToLive > (strategyInfo.range + Game.map.getRoomLinearDistance(creep.room.name, this.roomName)) * 50,
	);
	_.sortBy(availableGatherers, creep => Game.map.getRoomLinearDistance(creep.room.name, this.roomName));
	_.each(availableGatherers, creep => {
		// If we have enough gathering space assigned, we're done.
		if (assignedSpace >= numSymbols) return false;

		// Reassign gatherer to this room.
		creep.memory.targetRoom = this.roomName;
		creep.memory.origin = strategyInfo.origin;
		delete creep.memory.scoutTarget;
		assignedSpace += creep.store.getCapacity();
	});

	// @todo Consider resources from buildings that might need dismantling first.

	// @todo Also consider saving containers with resources if it's not one
	// of our harvest rooms, so we can "borrow" from other players.
};

/**
 * Commits info about invader outposts to memory.
 *
 * @param {object} structures
 *   An object containing Arrays of structures, keyed by structure type.
 */
RoomIntel.prototype.gatherInvaderIntel = function (structures) {
	delete this.memory.invaderInfo;

	const core = _.first(structures[STRUCTURE_INVADER_CORE]);
	if (!core) return;

	// Commit basic invader core info.
	this.memory.invaderInfo = {
		level: core.level,
		active: !core.ticksToDeploy,
		activates: core.ticksToDeploy ? Game.time + core.ticksToDeploy : undefined,
	};

	// Check when the core collapses.
	for (const effect of core.effects) {
		if (effect.effect === EFFECT_COLLAPSE_TIMER) {
			this.memory.invaderInfo.collapses = Game.time + effect.ticksRemaining;
		}
	}
};

/**
 * Commits pathfinding matrix to memory.
 *
 * @param {object} structures
 *   An object containing Arrays of structures, keyed by structure type.
 * @param {object} constructionSites
 *   An object containing Arrays of construction sites, keyed by structure type.
 */
RoomIntel.prototype.generateCostMatrix = function (structures, constructionSites) {
	this.memory.costMatrix = utilities.generateCostMatrix(this.roomName, structures, constructionSites).serialize();
	this.memory.pathfinderPositions = utilities.generateObstacleList(this.roomName, structures, constructionSites);

	const matrixSize = JSON.stringify(this.memory.costMatrix).length;
	const listSize = JSON.stringify(this.memory.pathfinderPositions).length;

	hivemind.log('intel', this.roomName).debug('Obstacle list takes', Math.ceil(10000 * listSize / matrixSize) / 100, '% of matrix storage size -', listSize, '/', matrixSize);

	if (matrixSize < listSize) {
		delete this.memory.pathfinderPositions;
	}
	else {
		delete this.memory.costMatrix;
	}
};

/**
 * Returns number of ticks since intel on this room was last gathered.
 *
 * @return {number}
 *   Number of ticks since intel was last gathered in this room.
 */
RoomIntel.prototype.getAge = function () {
	return Game.time - (this.memory.lastScan || -10000);
};

/**
 * Checks whether this room could be claimed by a player.
 *
 * @return {boolean}
 *   True if the room has a controller.
 */
RoomIntel.prototype.isClaimable = function () {
	if (this.memory.hasController) return true;
};

/**
 * Checks whether this room is claimed by another player.
 *
 * This checks ownership and reservations.
 *
 * @return {boolean}
 *   True if the room is claimed by another player.
 */
RoomIntel.prototype.isClaimed = function () {
	if (this.isOwned()) return true;
	if (this.memory.reservation && this.memory.reservation.username && this.memory.reservation.username !== utilities.getUsername()) return true;

	return false;
};

/**
 * Checks if the room is owned by another player.
 *
 * @return {boolean}
 *   True if the room is controlled by another player.
 */
RoomIntel.prototype.isOwned = function () {
	if (!this.memory.owner) return false;
	if (this.memory.owner !== utilities.getUsername()) return true;

	return false;
};

/**
 * Returns this room's last known rcl level.
 *
 * @return {number}
 *   Controller level of this room.
 */
RoomIntel.prototype.getRcl = function () {
	return this.memory.rcl || 0;
};

/**
 * Returns position of energy sources in the room.
 *
 * @return {object[]}
 *   An Array of ob objects containing id, x and y position of the source.
 */
RoomIntel.prototype.getSourcePositions = function () {
	return this.memory.sources || [];
};

/**
 * Returns type of mineral source in the room, if available.
 *
 * @return {string}
 *   Type of this room's mineral source.
 */
RoomIntel.prototype.getMineralType = function () {
	return this.memory.mineralInfo ? this.memory.mineralInfo.type : this.memory.mineralType;
};

/**
 * Returns position of mineral deposit in the room.
 *
 * @return {object}
 *   An Object containing id, type, x and y position of the mineral deposit.
 */
RoomIntel.prototype.getMineralPosition = function () {
	return this.memory.mineralInfo;
};

/**
 * Returns type of decoder in the room, if available.
 *
 * @return {string}
 *   Type of this room's decoder.
 */
RoomIntel.prototype.getDecoderType = function () {
	if (!this.memory.symbolDecoder) return null;
	return this.memory.symbolDecoder.symbol;
};

/**
 * Returns a cost matrix for the given room.
 *
 * @return {PathFinder.CostMatrix}
 *   A cost matrix representing this room.
 */
RoomIntel.prototype.getCostMatrix = function () {
	if (this.memory.costMatrix) return PathFinder.CostMatrix.deserialize(this.memory.costMatrix);

	if (this.memory.pathfinderPositions) {
		const matrix = new PathFinder.CostMatrix();

		for (const location of this.memory.pathfinderPositions.obstacles) {
			const pos = utilities.deserializePosition(location, this.roomName);
			matrix.set(pos.x, pos.y, 0xFF);
		}

		for (const location of this.memory.pathfinderPositions.roads) {
			const pos = utilities.deserializePosition(location, this.roomName);
			if (matrix.get(pos.x, pos.y) === 0) {
				matrix.set(pos.x, pos.y, 1);
			}
		}

		return matrix;
	}

	if (Game.rooms[this.roomName]) return Game.rooms[this.roomName].generateCostMatrix();

	return new PathFinder.CostMatrix();
};

/**
 * Checks whether there is a previously generated cost matrix for this room.
 *
 * @return {bool}
 *   Whether a cost matrix has previously been generated for this room.
 */
RoomIntel.prototype.hasCostMatrixData = function () {
	if (this.memory.costMatrix) return true;
	if (this.memory.pathfinderPositions) return true;

	return false;
};

/**
 * Returns a list of rooms connected to this one, keyed by direction.
 *
 * @return {object}
 *   Exits as returned by Game.map.getExits().
 */
RoomIntel.prototype.getExits = function () {
	return this.memory.exits || {};
};

/**
 * Returns position of the Controller structure in this room.
 *
 * @return {RoomPosition}
 *   Position of this room's controller.
 */
RoomIntel.prototype.getControllerPosition = function () {
	if (!this.memory.structures || !this.memory.structures[STRUCTURE_CONTROLLER]) return;

	const controller = _.sample(this.memory.structures[STRUCTURE_CONTROLLER]);
	return new RoomPosition(controller.x, controller.y, this.roomName);
};

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
RoomIntel.prototype.getStructures = function (structureType) {
	if (!this.memory.structures || !this.memory.structures[structureType]) return [];
	return this.memory.structures[structureType];
};

/**
 * Returns number of tiles of a certain type in a room.
 *
 * @param {string} type
 *   Tile type. Can be one of `plain`, `swamp`, `wall` or `exit`.
 *
 * @return {number}
 *   Number of tiles of the given type in this room.
 */
RoomIntel.prototype.countTiles = function (type) {
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
RoomIntel.prototype.calculateAdjacentRoomSafety = function (options) {
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
};

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
RoomIntel.prototype.addAdjacentRoomToCheck = function (roomName, openList, base) {
	if (this.otherUnsafeRooms.indexOf(roomName) === -1) {
		if (Game.rooms[roomName] && Game.rooms[roomName].isMine()) {
			// This is one of our own rooms, and as such is possibly safe.
			if ((Game.rooms[roomName].controller.level >= Math.min(5, this.getRcl() - 1)) && !Game.rooms[roomName].isEvacuating()) return;
			if (roomName === this.roomName) return;
		}

		if (this.otherSafeRooms.indexOf(roomName) > -1) return;
	}

	openList[roomName] = {
		range: base.range + 1,
		origin: base.dir,
		room: roomName,
	};
};

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
RoomIntel.prototype.handleAdjacentRoom = function (roomData, openList, closedList) {
	const roomIntel = hivemind.roomIntel(roomData.room);
	if (roomIntel.getAge() > 100000) {
		// Room has no intel, declare it as unsafe.
		this.newStatus[roomData.origin] = false;
		return;
	}

	// Add new adjacent rooms to openList if available.
	const roomExits = roomIntel.getExits();
	for (const roomName of _.values(roomExits)) {
		if (roomData.range >= 3) {
			// Room has open exits more than 3 rooms away.
			// Mark direction as unsafe.
			this.newStatus[roomData.origin] = false;
			break;
		}

		const found = openList[roomName] || closedList[roomName] || false;
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
};

/**
 * Registers a scout attempting to reach this room.
 */
RoomIntel.prototype.registerScoutAttempt = function () {
	this.memory.lastScout = Game.time;
};

/**
 * Determiness the last time a scout was assigned to this room.
 *
 * @return {number}
 *   Game tick when a scout attempt was last registered, or 0.
 */
RoomIntel.prototype.getLastScoutAttempt = function () {
	return this.memory.lastScout || 0;
};

/**
 * @code
 * _.each(Memory.rooms, (mem, roomName) => {if (mem.intel.wallBreaker) console.log(roomName, mem.intel.wallBreaker.total)})
 * @endcode
 */
RoomIntel.prototype.generateWallBreakerCostMatrix = function (room) {
	if (!room.name.startsWith('E10N2') && !room.name.startsWith('E20N2')) return;
	if (this.memory.wallBreaker && Game.time - this.memory.wallBreaker.generated < 5000) return;

	// Generate cost matrix for digging through wall.
	const matrix = new PathFinder.CostMatrix();
	_.each(room.find(FIND_STRUCTURES), structure => {
		if (structure.structureType !== STRUCTURE_WALL) {
			matrix.set(structure.pos.x, structure.pos.y, 255);
			return;
		}

		matrix.set(structure.pos.x, structure.pos.y, Math.ceil(100 * structure.hits / structure.hitsMax));
	});

	const result = PathFinder.search(
		new RoomPosition(29, 21, room.name),
		new RoomPosition(21, 29, room.name),
		{
			roomCallback: () => matrix,
			plainCost: 0,
			swampCost: 0,
			maxRooms: 1,
		}
	);

	this.memory.wallBreaker = {
		tiles: _.map(_.filter(result.path, pos => pos.lookFor(LOOK_STRUCTURES).length > 0), utilities.encodePosition),
		total: result.cost,
		generated: Game.time,
	};
};

module.exports = RoomIntel;
