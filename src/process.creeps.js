'use strict';

const Process = require('./process');
const CreepManager = require('./creep-manager');

// Normal creep roles.
const BuilderRole = require('./role.builder');
const ClaimerRole = require('./role.claimer');
const DismantlerRole = require('./role.dismantler');
const GiftRole = require('./role.gift');
const HarvesterRole = require('./role.harvester');
const PowerHarvesterRole = require('./role.harvester.power');
const PowerHaulerRole = require('./role.hauler.power');
const ScoutRole = require('./role.scout');
const UpgraderRole = require('./role.upgrader');

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
	this.creepManager.registerCreepRole('builder', new BuilderRole());
	this.creepManager.registerCreepRole('claimer', new ClaimerRole());
	this.creepManager.registerCreepRole('dismantler', new DismantlerRole());
	this.creepManager.registerCreepRole('gift', new GiftRole());
	this.creepManager.registerCreepRole('harvester', new HarvesterRole());
	this.creepManager.registerCreepRole('harvester.minerals', new HarvesterRole());
	this.creepManager.registerCreepRole('harvester.power', new PowerHarvesterRole());
	this.creepManager.registerCreepRole('hauler.power', new PowerHaulerRole());
	this.creepManager.registerCreepRole('scout', new ScoutRole());
	this.creepManager.registerCreepRole('upgrader', new UpgraderRole());

	this.powerCreepManager = new CreepManager();
	this.powerCreepManager.registerCreepRole('operator', new OperatorRole());
};

CreepsProcess.prototype = Object.create(Process.prototype);

/**
 * Runs logic for all creeps.
 */
CreepsProcess.prototype.run = function () {
	this.creepManager.onTickStart();
	this.creepManager.manageCreeps(Game.creeps);

	const powerCreeps = _.filter(Game.powerCreeps, creep => (creep.ticksToLive || 0) > 0);
	this.powerCreepManager.manageCreeps(powerCreeps);
};

module.exports = CreepsProcess;
