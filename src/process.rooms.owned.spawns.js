'use strict';

const Process = require('./process');
const SpawnManager = require('./spawn-manager');

const spawnRoles = [
	'brawler',
	'builder',
	'claimer',
	'dismantler',
	'exploit',
	'gift',
	'harvester',
	'harvester.minerals',
	'harvester.power',
	'hauler.power',
	'helper',
	'scout',
	'squad',
	'transporter',
	'upgrader',
];

/**
 * Runs reactions in a room's labs.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const ManageSpawnsProcess = function (params, data) {
	Process.call(this, params, data);
	this.room = params.room;

	this.spawnManager = new SpawnManager();
	for (const roleName of spawnRoles) {
		const SpawnClass = require('./spawn-role.' + roleName);
		this.spawnManager.registerSpawnRole(roleName, new SpawnClass());
	}
};

ManageSpawnsProcess.prototype = Object.create(Process.prototype);

/**
 * Manages a room's spawns.
 */
ManageSpawnsProcess.prototype.run = function () {
	const roomSpawns = _.filter(Game.spawns, spawn => spawn.pos.roomName === this.room.name && spawn.isOperational());
	this.visualizeSpawning(roomSpawns);
	this.spawnManager.manageSpawns(roomSpawns);
};

/**
 * Visualize which creeps are spawning in a room's spawns.
 *
 * @param {StructureSpawn[]} spawns
 *   An array containing the room's spawns.
 */
ManageSpawnsProcess.prototype.visualizeSpawning = function (spawns) {
	if (!this.room.visual) return;

	for (const spawn of spawns) {
		if (!spawn.spawning) continue;

		this.room.visual.text(spawn.spawning.name, spawn.pos.x + 0.05, spawn.pos.y + 0.05, {
			size: 0.5,
			color: 'black',
		});
		this.room.visual.text(spawn.spawning.name, spawn.pos.x, spawn.pos.y, {
			size: 0.5,
		});
	}
};

module.exports = ManageSpawnsProcess;
