'use strict';

/* global hivemind */

const Process = require('./process');
const SpawnPowerCreepsProcess = require('./process.creeps.power.spawn');
const CreepManager = require('./creep-manager');

// Normal creep roles.
const creepRoles = [
	'brawler',
	'builder',
	'builder.exploit',
	'builder.remote',
	'claimer',
	'dismantler',
	'gift',
	'harvester',
	'harvester.exploit',
	'harvester.power',
	'harvester.remote',
	'hauler',
	'hauler.exploit',
	'hauler.power',
	'helper',
	'scout',
	'transporter',
	'unassigned',
	'upgrader',
];

// Power creep roles.
const OperatorRole = require('./role.operator');

/**
 * Runs logic for all creeps and power creeps.
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
	for (const roleName of creepRoles) {
		const RoleClass = require('./role.' + roleName);
		this.creepManager.registerCreepRole(roleName, new RoleClass());
	}

	const HarvesterRole = require('./role.harvester');
	this.creepManager.registerCreepRole('harvester.minerals', new HarvesterRole());

	this.powerCreepManager = new CreepManager();
	this.powerCreepManager.registerCreepRole('operator', new OperatorRole());
};

CreepsProcess.prototype = Object.create(Process.prototype);

/**
 * Runs logic for all creeps.
 */
CreepsProcess.prototype.run = function () {
	// Run normal creeps.
	this.creepManager.onTickStart();
	_.each(Game.creepsByRole, (creeps, role) => {
		hivemind.runSubProcess('creeps_' + role, () => {
			this.creepManager.manageCreeps(creeps);
		});
	});
	this.creepManager.report();

	// Run power creeps.
	const powerCreeps = _.filter(Game.powerCreeps, creep => (creep.ticksToLive || 0) > 0);
	this.powerCreepManager.onTickStart();
	this.powerCreepManager.manageCreeps(powerCreeps);
	this.powerCreepManager.report();

	// Spawn power creeps.
	hivemind.runProcess('creeps_power_spawn', SpawnPowerCreepsProcess, {
		interval: 10,
	});
};

module.exports = CreepsProcess;
