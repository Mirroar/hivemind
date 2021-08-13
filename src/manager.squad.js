'use strict';

const utilities = require('./utilities');

/**
 * Squads are sets of creeps spawned in a single room.
 * @constructor
 *
 * @param {string}squadName
 *   Identifier of this squad for memory.
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
	// Check if there is a target for this squad.
	const targetPos = this.getTarget();
	if (!targetPos) return [];

	return [{
		priority: 5,
		weight: 0,
		target: utilities.encodePosition(targetPos),
	}];
};

/**
 * Orders squad to spawn in the given room.
 *
 * @param {string} roomName
 *   Name of the room to spawn in.
 */
Squad.prototype.setSpawn = function (roomName) {
	this.memory.spawnRoom = roomName;
};

/**
 * Determines which room the squad is set to spawn in.
 *
 * @return {string}
 *   Name of the room the squad spawns in.
 */
Squad.prototype.getSpawn = function () {
	return this.memory.spawnRoom;
};

/**
 * Orders squad to move toward the given position.
 *
 * @param {RoomPosition} targetPos
 *   Position the squad is supposed to move to.
 */
Squad.prototype.setTarget = function (targetPos) {
	if (targetPos) {
		this.memory.targetPos = utilities.encodePosition(targetPos);
	}
	else {
		delete this.memory.targetPos;
	}
};

/**
 * Determines which room position the squad is currently targeting.
 *
 * @return {RoomPosition}
 *   Position the squad is supposed to move to.
 */
Squad.prototype.getTarget = function () {
	if (this.memory.targetPos) {
		return utilities.decodePosition(this.memory.targetPos);
	}
};

module.exports = Squad;
