'use strict';

const Process = require('./process');
const CreepManager = require('./creep-manager');

const ScoutRole = require('./role.scout');

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
	this.creepManager.registerCreepRole('scout', new ScoutRole());
};

CreepsProcess.prototype = Object.create(Process.prototype);

/**
 * Runs logic for all creeps.
 */
CreepsProcess.prototype.run = function () {
	this.creepManager.onTickStart();
	this.creepManager.manageCreeps(Game.creeps);
};

module.exports = CreepsProcess;
