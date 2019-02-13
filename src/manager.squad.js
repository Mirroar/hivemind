'use strict';

/* global RoomPosition COLOR_GREEN COLOR_RED MOVE CLAIM HEAL RANGED_ATTACK */

const utilities = require('./utilities');

/**
 * Squads are sets of creeps spawned in a single room.
 * @constructor
 *
 * @param {string}squadName
 *   Identifier of this squad for memory and flag names.
 */
const Squad = function (squadName) {
	this.name = squadName;
	this.units = {};

	if (!Memory.squads) {
		Memory.squads = {};
	}

	if (!Memory.squads[squadName]) {
		Memory.squads[squadName] = {
			composition: {},
			fullySpawned: false,
		};
	}

	const spawnFlag = Game.flags['SpawnSquad:' + squadName];
	if (spawnFlag && spawnFlag.color !== COLOR_GREEN) {
		spawnFlag.setColor(COLOR_GREEN);
	}

	const attackFlag = Game.flags['AttackSquad:' + squadName];
	if (attackFlag && attackFlag.color !== COLOR_RED) {
		attackFlag.setColor(COLOR_RED);
	}

	this.memory = Memory.squads[squadName];
};

/**
 * Adds one unit of a certain type to the squad's composition.
 *
 * @param {string} unitType
 *   Type identifier of the unit to add.
 *
 * @return {number}
 *   New amount of units of the specified type in the squad.
 */
Squad.prototype.addUnit = function (unitType) {
	if (!this.memory.composition[unitType]) {
		this.memory.composition[unitType] = 0;
	}

	this.memory.composition[unitType]++;

	return this.memory.composition[unitType];
};

/**
 * Removes one unit of a certain type from the squad's composition.
 *
 * @param {string} unitType
 *   Type identifier of the unit to remove.
 *
 * @return {number}
 *   New amount of units of the specified type in the squad.
 */
Squad.prototype.removeUnit = function (unitType) {
	if (!this.memory.composition[unitType]) {
		return;
	}

	this.memory.composition[unitType]--;

	return this.memory.composition[unitType];
};

/**
 * Set the number of requested units of a certain type.
 *
 * @param {string} unitType
 *   Type identifier of the unit to modify.
 * @param {number} count
 *   Number of units of the chosen type that should be in this squad.
 */
Squad.prototype.setUnitCount = function (unitType, count) {
	this.memory.composition[unitType] = count;
};

/**
 * Clears all registered units for this squad.
 */
Squad.prototype.clearUnits = function () {
	this.memory.composition = {};
};

/**
 * Stops spawning units and removes a squad completely.
 */
Squad.prototype.disband = function () {
	this.clearUnits();
	this.setSpawn(null);
	this.setTarget(null);
	// @todo Recycle units, then clear memory.
};

/**
 * Decides whether this squad needs additional units spawned.
 *
 * @return {string|null}
 *   Type of the unit that needs spawning.
 */
Squad.prototype.needsSpawning = function () {
	for (const unitType in this.memory.composition) {
		if (this.memory.composition[unitType] > _.size(this.units[unitType])) {
			return unitType;
		}
	}

	this.memory.fullySpawned = true;
	return null;
};

/**
 * Spawns another unit for this squad.
 *
 * @param {StructureSpawn} spawn
 *   Spawn to use for creating creeps.
 *
 * @return {boolean}
 *   Whether a new unit is being spawned.
 */
Squad.prototype.spawnUnit = function (spawn) {
	const toSpawn = this.needsSpawning();

	if (!toSpawn) return false;

	if (toSpawn === 'ranger') {
		spawn.createManagedCreep({
			role: 'brawler',
			bodyWeights: {
				[MOVE]: 0.5,
				[RANGED_ATTACK]: 0.3,
				[HEAL]: 0.2,
			},
			memory: {
				squadName: this.name,
				squadUnitType: toSpawn,
			},
		});
	}
	else if (toSpawn === 'healer') {
		let boosts = null;
		if (spawn.room.canSpawnBoostedCreeps()) {
			const availableBoosts = spawn.room.getAvailableBoosts('heal');
			let bestBoost;
			_.each(availableBoosts, (info, resourceType) => {
				if (info.available >= 50) {
					if (!bestBoost || info.effect > availableBoosts[bestBoost].effect) {
						bestBoost = resourceType;
					}
				}
			});

			if (bestBoost) {
				boosts = {
					heal: bestBoost,
				};
			}
		}

		spawn.createManagedCreep({
			role: 'brawler',
			bodyWeights: {move: 0.52, heal: 0.48},
			boosts,
			memory: {
				squadName: this.name,
				squadUnitType: toSpawn,
			},
		});
	}
	else if (toSpawn === 'claimer') {
		spawn.createManagedCreep({
			role: 'brawler',
			bodyWeights: {move: 0.52, tough: 0.18, claim: 0.3},
			memory: {
				squadName: this.name,
				squadUnitType: toSpawn,
			},
		});
	}
	else if (toSpawn === 'singleClaim') {
		spawn.createManagedCreep({
			role: 'brawler',
			body: [MOVE, MOVE, MOVE, MOVE, MOVE, CLAIM],
			memory: {
				squadName: this.name,
				squadUnitType: toSpawn,
			},
		});
	}
	else if (toSpawn === 'builder') {
		spawn.createManagedCreep({
			role: 'brawler',
			bodyWeights: {move: 0.52, carry: 0.38, work: 0.1},
			memory: {
				squadName: this.name,
				squadUnitType: toSpawn,
			},
		});
	}
	else if (toSpawn === 'attacker') {
		let boosts;
		if (spawn.room.canSpawnBoostedCreeps()) {
			const availableBoosts = spawn.room.getAvailableBoosts('attack');
			let bestBoost;
			_.each(availableBoosts, (info, resourceType) => {
				if (info.available >= 50) {
					if (!bestBoost || info.effect > availableBoosts[bestBoost].effect) {
						bestBoost = resourceType;
					}
				}
			});

			if (bestBoost) {
				boosts = {
					attack: bestBoost,
				};
			}
		}

		spawn.createManagedCreep({
			role: 'brawler',
			bodyWeights: {move: 0.5, attack: 0.5},
			boosts,
			memory: {
				squadName: this.name,
				squadUnitType: toSpawn,
			},
		});
	}
	else if (toSpawn === 'test') {
		spawn.createManagedCreep({
			role: 'brawler',
			body: [MOVE],
			memory: {
				squadName: this.name,
				squadUnitType: toSpawn,
			},
		});
	}
	else {
		spawn.createManagedCreep({
			role: 'brawler',
			bodyWeights: {move: 0.5, attack: 0.3, heal: 0.2},
			memory: {
				squadName: this.name,
				squadUnitType: toSpawn,
			},
		});
	}

	return true;
};

/**
 * Gets current squad orders with priorities.
 *
 * @return {Array}
 *   An array of objects containing squad orders.
 */
Squad.prototype.getOrders = function () {
	const options = [];

	if (this.memory.fullySpawned) {
		// Check if there is an attack flag for this squad.
		const attackFlags = _.filter(Game.flags, flag => flag.name === 'AttackSquad:' + this.name);
		if (attackFlags.length > 0) {
			options.push({
				priority: 5,
				weight: 0,
				target: utilities.encodePosition(attackFlags[0].pos),
			});
		}
	}

	return options;
};

/**
 * Sets a waypoint path for all units of this squad to follow after spawning.
 *
 * @param {string} pathName
 *   Name of the waypoint path to follow.
 */
Squad.prototype.setPath = function (pathName) {
	this.memory.pathName = pathName;

	// @todo If there are creeps already spawned, send them on the path.
};

/**
 * Orders squad to spawn in the given room.
 *
 * @param {string} roomName
 *   Name of the room to spawn in.
 */
Squad.prototype.setSpawn = function (roomName) {
	const key = 'SpawnSquad:' + this.name;
	const flag = Game.flags[key];
	if (!roomName) {
		if (flag) {
			// Remove spawn flag.
			flag.remove();
		}

		return;
	}

	const spawnPos = new RoomPosition(25, 25, roomName);
	if (flag) {
		flag.setPosition(spawnPos);
	}
	else {
		spawnPos.createFlag(key);
	}
};

/**
 * Orders squad to move toward the given position.
 *
 * @param {RoomPosition} targetPos
 *   Position the squad is supposed to move to.
 */
Squad.prototype.setTarget = function (targetPos) {
	const key = 'AttackSquad:' + this.name;
	const flag = Game.flags[key];
	if (!targetPos) {
		if (flag) {
			// Remove spawn flag.
			flag.remove();
		}

		return;
	}

	if (flag) {
		flag.setPosition(targetPos);
	}
	else {
		targetPos.createFlag(key);
	}
};

module.exports = Squad;
