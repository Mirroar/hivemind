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
	// @todo Use memory instead of flags and add visualization.
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
 * Determines which room the squad is set to spawn in.
 *
 * @return {string}
 *   Name of the room the squad spawns in.
 */
Squad.prototype.getSpawn = function () {
	const key = 'SpawnSquad:' + this.name;
	const flag = Game.flags[key];
	if (flag) {
		return flag.pos.roomName;
	}
};

/**
 * Orders squad to move toward the given position.
 *
 * @param {RoomPosition} targetPos
 *   Position the squad is supposed to move to.
 */
Squad.prototype.setTarget = function (targetPos) {
	// @todo Use memory instead of flags and add visualization.
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

/**
 * Determines which room position the squad is currently targeting.
 */
Squad.prototype.getTarget = function () {
	const key = 'AttackSquad:' + this.name;
	const flag = Game.flags[key];
	if (flag) {
		return flag.pos;
	}
};

module.exports = Squad;
