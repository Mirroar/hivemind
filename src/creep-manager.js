'use strict';

/* global hivemind */

const utilities = require('./utilities');

/**
 * Generally responsible for all creeps' logic.
 * @constructor
 */
const CreepManager = function () {
	this.roles = {};
	this.performance = {};
	this.prepareStatMemory('total');
};

/**
 * Registers a role to be managed.
 *
 * @param {String} roleId
 *   Identifier of the role, as stored in a creep's memory.
 * @param {Role} role
 *   The role to register.
 */
CreepManager.prototype.registerCreepRole = function (roleId, role) {
	this.roles[roleId] = role;
	this.prepareStatMemory(roleId);
};

/**
 * Runs cleanup tasks at the beginning of a tick.
 */
CreepManager.prototype.onTickStart = function () {
	this.performance = {};
	this.prepareStatMemory('total');
	_.each(_.keys(this.roles), roleId => this.prepareStatMemory(roleId));
};

/**
 * Prepares memory for storing creep CPU statistics.
 *
 * @param {String} roleId
 *   Identifier of the role, or 'total'.
 */
CreepManager.prototype.prepareStatMemory = function (roleId) {
	this.performance[roleId] = {
		run: 0,
		throttled: 0,
		total: 0,
		average: 0,
	};
};

/**
 * Decides whether a creep's logic should run during this tick.
 *
 * @param {Creep} creep
 *   The creep in question.
 *
 * @return {boolean}
 *   True if the creep's logic should not be executed this tick.
 */
CreepManager.prototype.throttleCreep = function (creep) {
	const role = this.roles[creep.memory.role];

	// Do not throttle creeps at room borders, so they don't accidentaly
	// transition back to their previous room.
	if (creep.pos.x === 0 || creep.pos.x === 49 || creep.pos.y === 0 || creep.pos.y === 49) return false;

	if (!creep.memory._tO) creep.memory._tO = utilities.getThrottleOffset();
	return utilities.throttle(creep.memory._tO, role.stopAt, role.throttleAt);
};

/**
 * Runs logic for a creep according to its role.
 *
 * @param {Creep} creep
 *   The creep in question.
 */
CreepManager.prototype.runCreepLogic = function (creep) {
	if (creep.spawning) return;
	if (!this.canManageCreep(creep)) return;

	const roleId = creep.memory.role;

	if (this.throttleCreep(creep)) {
		this.performance.total.throttled++;
		this.performance[roleId].throttled++;
		return;
	}

	const startTime = Game.cpu.getUsed();

	this.performance.total.run++;
	this.performance[roleId].run++;

	let shouldRun = true;
	if (this.roles[roleId].preRun) {
		shouldRun = this.roles[roleId].preRun(creep);
	}

	if (shouldRun !== false) {
		this.roles[roleId].run(creep);
	}

	this.recordCreepCpuStats(roleId, Game.cpu.getUsed() - startTime);
};

/**
 * Decides whether this creep manager can handle a given creep.
 *
 * @param {Creep} creep
 *   The creep in question.
 *
 * @return {boolean}
 *   True if this creep manager could run logic for this creep.
 */
CreepManager.prototype.canManageCreep = function (creep) {
	if (creep.memory.role && this.roles[creep.memory.role]) {
		return true;
	}

	return false;
};

/**
 * Stores CPU statistics for a creep after running logic.
 *
 * @param {String} roleId
 *   Identifier of the role, as stored in a creep's memory.
 * @param {Number} totalTime
 *   Total CPU time spent running this creep's logic.
 */
CreepManager.prototype.recordCreepCpuStats = function (roleId, totalTime) {
	_.each([this.performance.total, this.performance[roleId]], memory => {
		memory.total += totalTime;

		if (!memory.min || totalTime < memory.min) {
			memory.min = totalTime;
		}

		if (!memory.max || totalTime > memory.max) {
			memory.max = totalTime;
		}
	});
};

/**
 * Runs logic for all creeps in a list.
 *
 * @param {Array|Object} creeps
 *   List of all the creeps to handle.
 */
CreepManager.prototype.manageCreeps = function (creeps) {
	_.each(creeps, creep => {
		this.runCreepLogic(creep);
	});
};

/**
 * Reports statistics like throttled creeps.
 */
CreepManager.prototype.report = function () {
	if (this.performance.total.throttled) {
		const total = this.performance.total.throttled + this.performance.total.run;
		hivemind.log('creeps').debug(this.performance.total.throttled, 'of', total, 'creeps have been throttled due to bucket this tick.');
	}
};

module.exports = CreepManager;
