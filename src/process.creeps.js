'use strict';

const Process = require('./process');
const CreepManager = require('./creep-manager');

// Normal creep roles.
const ClaimerRole = require('./role.claimer');
const ScoutRole = require('./role.scout');

// Power creep roles.
const OperatorRole = require('./role.operator');

/**
 * Runs logic for all rooms we have visibility in.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const CreepsProcess = function (params, data) {
	Process.call(this, params, data);

	this.creepManager = new CreepManager();
	this.creepManager.registerCreepRole('claimer', new ClaimerRole());
	this.creepManager.registerCreepRole('scout', new ScoutRole());

	this.creepManager.registerCreepRole('operator', new OperatorRole());
};

CreepsProcess.prototype = Object.create(Process.prototype);

/**
 * Runs logic for all creeps.
 */
CreepsProcess.prototype.run = function () {
	this.creepManager.onTickStart();
	this.creepManager.manageCreeps(Game.creeps);

	const powerCreeps = _.filter(Game.powerCreeps, creep => (creep.ticksToLive || 0) > 0);
	this.creepManager.manageCreeps(powerCreeps);
};

module.exports = CreepsProcess;
