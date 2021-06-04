'use strict';

const Process = require('./process');
const SpawnManager = require('./spawn-manager');

const spawnRoles = [
	'brawler',
	'builder',
	'claimer',
	'dismantler',
	'exploit',
	'gatherer',
	'gift',
	'harvester',
	'harvester.minerals',
	'harvester.power',
	'harvester.remote',
	'hauler',
	'hauler.power',
	'helper',
	'scout',
	'squad',
	'transporter',
	'upgrader',
];
const spawnClasses = {};
const historyChunkLength = 100;
const maxHistoryChunks = 20;

for (const roleName of spawnRoles) {
	spawnClasses[roleName] = require('./spawn-role.' + roleName);
}

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
		this.spawnManager.registerSpawnRole(roleName, new spawnClasses[roleName]());
	}
};

ManageSpawnsProcess.prototype = Object.create(Process.prototype);

/**
 * Manages a room's spawns.
 */
ManageSpawnsProcess.prototype.run = function () {
	const roomSpawns = _.filter(Game.spawns, spawn => spawn.pos.roomName === this.room.name && spawn.isOperational());
	this.visualizeSpawning(roomSpawns);
	this.spawnManager.manageSpawns(this.room, roomSpawns);
	this.collectSpawnStats(roomSpawns);
};

ManageSpawnsProcess.prototype.collectSpawnStats = function (spawns) {
	if (!this.room.memory.spawns) this.room.memory.spawns = {};
	const memory = this.room.memory.spawns;

	for (const spawn of spawns) {
		if (!memory[spawn.id]) {
			memory[spawn.id] = {
				ticks: 0,
				spawning: 0,
				waiting: 0,
				history: [],
			};
		}

		const spawnMemory = memory[spawn.id];
		spawnMemory.ticks++;
		if (spawn.spawning) spawnMemory.spawning++;
		if (spawn.waiting) spawnMemory.waiting++;

		if (spawnMemory.ticks >= historyChunkLength) {
			// Save current history as new chunk.
			spawnMemory.history.push({
				ticks: spawnMemory.ticks,
				spawning: spawnMemory.spawning,
				waiting: spawnMemory.waiting,
			});
			spawnMemory.history = spawnMemory.history.slice(-maxHistoryChunks);

			// Reset current history values.
			spawnMemory.ticks = 0;
			spawnMemory.spawning = 0;
			spawnMemory.waiting = 0;
		}
	}
};

/**
 * Visualize which creeps are spawning in a room's spawns.
 *
 * @param {StructureSpawn[]} spawns
 *   An array containing the room's spawns.
 */
ManageSpawnsProcess.prototype.visualizeSpawning = function (spawns) {
	if (!this.room.visual) return;
	if (!this.room.memory.spawns) return;

	for (const spawn of spawns) {
		// Show spawn usage stats.
		const memory = this.room.memory.spawns[spawn.id] || {ticks: 1, spawning: 0, waiting: 0, history: []};
		const totalTicks = memory.ticks + (memory.history.length * historyChunkLength);
		const spawningTicks = _.reduce(memory.history, (total, h) => total + h.spawning, memory.spawning);
		const waitingTicks = _.reduce(memory.history, (total, h) => total + h.waiting, memory.waiting);
		this.room.visual.rect(spawn.pos.x - 0.5, spawn.pos.y, 1, 0.3, {fill: '#888888', opacity: 0.5});
		this.room.visual.rect(spawn.pos.x - 0.5, spawn.pos.y, spawningTicks / totalTicks, 0.3, {fill: '#88ff88'});
		this.room.visual.rect(spawn.pos.x - 0.5 + (spawningTicks / totalTicks), spawn.pos.y, waitingTicks / totalTicks, 0.3, {fill: '#ff8888'});

		if (!spawn.spawning) continue;

		// Show name of currently spawning creep.
		this.room.visual.text(spawn.spawning.name, spawn.pos.x + 0.05, spawn.pos.y + 0.65, {
			size: 0.5,
			color: 'black',
		});
		this.room.visual.text(spawn.spawning.name, spawn.pos.x, spawn.pos.y + 0.6, {
			size: 0.5,
		});
	}
};

module.exports = ManageSpawnsProcess;
