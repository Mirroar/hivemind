'use strict';

/* global hivemind StructureSpawn Room BODYPART_COST OK
SOURCE_ENERGY_CAPACITY ENERGY_REGEN_TIME CARRY_CAPACITY CARRY */

const stats = require('./stats');
const utilities = require('./utilities');

const roleNameMap = {
	builder: 'B',
	'builder.exploit': 'BE',
	'builder.remote': 'BR',
	claimer: 'C',
	dismantler: 'D',
	brawler: 'F',
	guardian: 'FE',
	gift: ':) GIFT (: ',
	harvester: 'H',
	'harvester.exploit': 'HE',
	'harvester.minerals': 'HM',
	'harvester.remote': 'HR',
	'harvester.power': 'HP',
	scout: 'S',
	transporter: 'T',
	'hauler.exploit': 'TE',
	'hauler.power': 'TP',
	hauler: 'TR',
	upgrader: 'U',
};

// @todo Choose the best spawn for a creep (distance to target).

/**
 * Intelligently tries to create a creep.
 *
 * @param {pbject} options
 *   An object containing conditions for creating this creep:
 *   - body: An array of body part constants to create the creep from.
 *   - bodyWeights: Alternative to body, an array keyed by body part names,
 *     with values describing the percantage of the creep body that should
 *     consist of parts of this type.
 *   - memory: Memory to save on this creep on creation.
 *   - role: Role identifier of the creep, if not set on memory.
 *   - maxCost: Maximum amount of energy to spend on this creep.
 *   - maxParts: An array keyed by body part names containing the maximum
 *     amount of parts of that type to spawn the creep with.
 *
 * @return {string|boolean}
 *   The name of the creep if it could be spawned, false otherwise.
 */
StructureSpawn.prototype.createManagedCreep = function (options) {
	if (!options) {
		throw new Error('No options for creep spawning defined.');
	}

	if (this.spawning) return false;

	let enoughEnergy = true;
	const minCost = options.minCost || this.room.energyCapacityAvailable * 0.9;

	const energyAvailable = Math.min(this.room.energyAvailable, this.room.energyCapacityAvailable);
	if (energyAvailable < minCost) {
		enoughEnergy = false;
	}

	const totalCost = this.finalizeCreepBody(options, minCost, energyAvailable);

	if (energyAvailable >= totalCost) {
		enoughEnergy = true;
	}

	if (!enoughEnergy || this.canCreateCreep(options.body) !== OK) {
		return false;
	}

	// Prepare creep memory.
	const memory = options.memory || {};

	if (!memory.role) {
		memory.role = options.role || 'unknown';
	}

	// Store creep's body definition in memory for easier access.
	memory.body = _.countBy(options.body);

	// Generate creep name.
	if (!Memory.creepCounter) {
		Memory.creepCounter = {};
	}

	if (!Memory.creepCounter[memory.role] || Memory.creepCounter[memory.role] >= 36 * 36) {
		Memory.creepCounter[memory.role] = 0;
	}

	const roleName = roleNameMap[memory.role] || memory.role;
	const newName = roleName + '_' + Memory.creepCounter[memory.role].toString(36);

	// Actually try to spawn this creep.
	const result = this.createCreep(options.body, newName, memory);

	if (result !== newName) return false;

	// Spawning successful.
	Memory.creepCounter[memory.role]++;
	hivemind.log('creeps', this.pos.roomName).debug('Spawning new creep:', newName);

	// Also notify room's boost manager if necessary.
	if (options.boosts && this.room.boostManager) {
		this.room.boostManager.markForBoosting(newName, options.boosts);
	}

	// Store role of spawning creep for visualization.
	this.memory.spawnRole = memory.role;

	return result;
};

/**
 * Generates creep body as it should be spawned.
 *
 * @param {object} options
 *   An object containing conditions for creating this creep.
 * @param {number} minCost
 *   Minimum cost of the creep to create.
 * @param {number} energyAvailable
 *   Amount of energy currently available for spawning.
 *
 * @return {number}
 *   Cost of the body as it will be generated.
 */
StructureSpawn.prototype.finalizeCreepBody = function (options, minCost, energyAvailable) {
	let maxCost = Math.max(minCost, energyAvailable);
	if (options.body) {
		// Use the actual cost of a creep with this body.
		let partsCost = 0;
		for (const part of options.body) {
			partsCost += BODYPART_COST[part];
		}

		// @todo Shouldn't this be math.max?
		return Math.min(maxCost, partsCost);
	}

	if (!options.bodyWeights) {
		throw new Error('No body definition for creep found.');
	}

	// Creep might be requested with a maximum energy cost.
	if (options.maxCost) {
		maxCost = Math.min(maxCost, options.maxCost);
	}

	// Creep might be requested with a part limit.
	// With theoretically unlimited energy, check how expensive the creep can become with maxSize.
	const tempBody = utilities.generateCreepBody(options.bodyWeights, this.room.energyCapacityAvailable, options.maxParts);
	if (tempBody) {
		let maxPartsCost = 0;
		for (const part of tempBody) {
			maxPartsCost += BODYPART_COST[part];
		}

		maxCost = Math.min(maxCost, maxPartsCost);
	}

	options.body = utilities.generateCreepBody(options.bodyWeights, maxCost, options.maxParts);

	return maxCost;
};

/**
 * Spawns creeps in a room whenever needed.
 */
Room.prototype.manageSpawns = function (spawnManager, roomSpawns) {
	// If the new spawn code is trying to spawn something, give it priority.
	if (spawnManager.manageSpawns(this, roomSpawns)) return;

	for (const spawn of _.values(roomSpawns)) {
		if (spawn.spawning) continue;

		spawn.spawnCreeps();
		// @todo Stop spawning for a bit if creeps are queued for renewing.

		// Let only one spawner start spawning each tick to prevent confusion.
		break;
	}
};

/**
 * Spawns basic needed creeps at a spawn.
 */
StructureSpawn.prototype.spawnCreeps = function () {
	// We've got nothing to do, how about some remote harvesting?
	const harvestPositions = this.room.getRemoteHarvestSourcePositions();

	for (const harvestPosition of harvestPositions) {
		// If it's safe or brawler is sent, start harvesting.
		if (this.spawnRemoteHarvesters(harvestPosition)) return;
	}
};

/**
 * Spawns remote harvesters to harvest a certain source.
 *
 * @param {RoomPosition} harvestPosition
 *   Position of the source that needs harvesting.
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
StructureSpawn.prototype.spawnRemoteHarvesters = function (harvestPosition) {
	const flagPosition = utilities.encodePosition(harvestPosition);
	const position = this.room.storage ? this.room.storage.pos : this.pos;
	const homeLocation = utilities.encodePosition(position);

	// Cache path when possible.
	try {
		utilities.precalculatePaths(this.room, harvestPosition);
	}
	catch (error) {
		console.log('Error in pathfinding:', error);
		console.log(error.stack);
	}

	if (!this.room.memory.remoteHarvesting || !this.room.memory.remoteHarvesting[flagPosition]) return false;

	const memory = this.room.memory.remoteHarvesting[flagPosition];
	let doSpawn = false;

	memory.harvesters = [];
	const harvesters = _.filter(Game.creepsByRole['harvester.remote'] || {}, creep => creep.memory.storage === homeLocation && creep.memory.source === flagPosition);

	const maxRemoteHarvesters = 1;
	let travelTime;
	let travelTimeSpawn;
	if (memory.travelTime) {
		travelTime = memory.travelTime;
		travelTimeSpawn = memory.travelTime;
	}

	if (memory.cachedPath && memory.cachedPath.path) {
		// Path length is more accurate than observed travel time, because it's calculated between storage and source, not spawn and source.
		travelTime = memory.cachedPath.path.length;

		if (!travelTimeSpawn) {
			travelTimeSpawn = memory.cachedPath.path.length;
		}
	}

	for (const creep of _.values(harvesters)) {
		if (!travelTimeSpawn || creep.ticksToLive > travelTimeSpawn || creep.ticksToLive > 500 || creep.spawning) {
			memory.harvesters.push(creep.id);
		}
	}

	if (memory.harvesters.length < maxRemoteHarvesters) {
		doSpawn = true;
	}

	if (doSpawn) {
		const result = this.spawnRemoteHarvester(harvestPosition);
		if (result) {
			const cost = this.calculateCreepBodyCost(Memory.creeps[result].body);
			stats.addRemoteHarvestCost(this.room.name, utilities.encodePosition(harvestPosition), cost);

			return true;
		}
	}

	if (this.spawnRemoteHarvestHaulers({
		homeLocation,
		travelTime,
		travelTimeSpawn,
		harvestPosition,
	})) return true;
};

/**
 * Spawns remote harvesters to harvest a certain source.
 *
 * @param {object} info
 *   Precalculated information from spawnRemoteHarvesters().
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
StructureSpawn.prototype.spawnRemoteHarvestHaulers = function (info) {
	const flagPosition = utilities.encodePosition(info.harvestPosition);
	const memory = this.room.memory.remoteHarvesting[flagPosition];

	const haulerCount = _.size(_.filter(Game.creepsByRole.hauler || {}, creep =>
		creep.memory.storage === info.homeLocation &&
		creep.memory.source === flagPosition &&
		(creep.ticksToLive > Math.min(info.travelTimeSpawn || 0, 500) || creep.spawning)
	));

	let maxRemoteHaulers = 0;
	let maxCarryParts;
	if (memory.revenue > 0 || memory.hasContainer) {
		maxRemoteHaulers = 1;

		if (Game.rooms[info.harvestPosition.roomName]) {
			const room = Game.rooms[info.harvestPosition.roomName];
			if (room.controller && (room.controller.my || (room.controller.reservation && room.controller.reservation.username === utilities.getUsername()))) {
				maxRemoteHaulers = 2;
			}
		}
	}

	if (info.travelTime) {
		maxCarryParts = Math.ceil(info.travelTime * SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME / CARRY_CAPACITY);

		// If we cannot create big enough haulers (yet), create more of them!
		const bodyWeights = this.getHaulerBodyWeights();
		const maxHauler = utilities.generateCreepBody(bodyWeights, this.room.energyCapacityAvailable, {carry: maxCarryParts});
		let carryCount = 0;
		for (const j in maxHauler) {
			if (maxHauler[j] === CARRY) {
				carryCount++;
			}
		}

		const multiplier = Math.min(maxCarryParts / carryCount, 3);
		maxRemoteHaulers *= multiplier;
	}

	if (haulerCount < maxRemoteHaulers) {
		// Spawn hauler if necessary, but not if harvester is needed first.
		const result = this.spawnHauler(info.harvestPosition, maxCarryParts);
		if (result) {
			const cost = this.calculateCreepBodyCost(Memory.creeps[result].body);
			stats.addRemoteHarvestCost(this.room.name, utilities.encodePosition(info.harvestPosition), cost);

			return true;
		}
	}
};

/**
 * Spawns harvesters to gather energy in other rooms.
 *
 * @param {RoomPosition} targetPosition
 *   Position of the source that needs harvesting.
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
StructureSpawn.prototype.spawnRemoteHarvester = function (targetPosition) {
	let bodyWeights = {move: 0.5, work: 0.2, carry: 0.3};
	const maxParts = {work: 3};
	// Use less work parts if room is not reserved yet.
	if (Game.rooms[targetPosition.roomName]) {
		const room = Game.rooms[targetPosition.roomName];
		if (room.controller && (room.controller.my || (room.controller.reservation && room.controller.reservation.username === utilities.getUsername()))) {
			maxParts.work = 6;
		}
	}
	// @todo Also use high number of work parts if road still needs to be built.

	// Use less move parts if a road has already been established.
	if (this.room.memory.remoteHarvesting && this.room.memory.remoteHarvesting[utilities.encodePosition(targetPosition)] && this.room.memory.remoteHarvesting[utilities.encodePosition(targetPosition)].revenue > 0) {
		// @todo Use calculated max size like normal harvesters.
		bodyWeights = {move: 0.35, work: 0.55, carry: 0.1};
	}

	let position = this.pos;
	if (this.room.storage) {
		position = this.room.storage.pos;
	}

	return this.createManagedCreep({
		role: 'harvester.remote',
		bodyWeights,
		maxParts,
		memory: {
			storage: utilities.encodePosition(position),
			source: utilities.encodePosition(targetPosition),
		},
	});
};

/**
 * Determine body weights for haulers.
 *
 * @return {object}
 *   An object containing body part weights, keyed by type.
 */
StructureSpawn.prototype.getHaulerBodyWeights = function () {
	return {move: 0.35, work: 0.05, carry: 0.6};
};

/**
 * Spawns a new hauler.
 *
 * @param {RoomPosition} targetPosition
 *   Position of the source that should be hauled from.
 * @param {number} maxCarryParts
 *   Maximum number of carry parts the hauler should have.
 *
 * @return {boolean}
 *   True if we started spawning a creep.
 */
StructureSpawn.prototype.spawnHauler = function (targetPosition, maxCarryParts) {
	let maxParts = null;
	if (maxCarryParts) {
		maxParts = {carry: maxCarryParts};
	}

	let position = this.pos;
	if (this.room.storage) {
		position = this.room.storage.pos;
	}

	const bodyWeights = this.getHaulerBodyWeights();

	return this.createManagedCreep({
		role: 'hauler',
		bodyWeights,
		maxParts,
		memory: {
			storage: utilities.encodePosition(position),
			source: utilities.encodePosition(targetPosition),
		},
	});
};
