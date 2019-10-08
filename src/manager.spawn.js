'use strict';

/* global hivemind StructureSpawn Room BODYPART_COST OK */

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
	spawnManager.manageSpawns(this, roomSpawns);
};
