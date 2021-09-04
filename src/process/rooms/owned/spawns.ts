declare global {
	interface RoomMemory {
		spawns,
	}
}

import Process from 'process/process';
import SpawnManager from 'spawn-manager';

import brawlerSpawnRole from 'spawn-role/brawler';
import builderSpawnRole from 'spawn-role/builder';
import claimerSpawnRole from 'spawn-role/claimer';
import dismantlerSpawnRole from 'spawn-role/dismantler';
import exploitSpawnRole from 'spawn-role/exploit';
import gathererSpawnRole from 'spawn-role/gatherer';
import giftSpawnRole from 'spawn-role/gift';
import harvesterSpawnRole from 'spawn-role/harvester';
import mineralHarvesterSpawnRole from 'spawn-role/harvester.minerals';
import powerHarvesterSpawnRole from 'spawn-role/harvester.power';
import remoteHarvesrterSpawnRole from 'spawn-role/harvester.remote';
import haulerSpawnRole from 'spawn-role/hauler';
import powerHaulerSpawnRole from 'spawn-role/hauler.power';
import helperSpawnRole from 'spawn-role/helper';
import roomDefenseSpawnRole from 'spawn-role/room-defense';
import scoutSpawnRole from 'spawn-role/scout';
import squadSpawnRole from 'spawn-role/squad';
import transporterSpawnRole from 'spawn-role/transporter';
import upgraderSpawnRole from 'spawn-role/upgrader';

const spawnClasses = {
	'brawler': brawlerSpawnRole,
	'builder': builderSpawnRole,
	'claimer': claimerSpawnRole,
	'dismantler': dismantlerSpawnRole,
	'exploit': exploitSpawnRole,
	'gatherer': gathererSpawnRole,
	'gift': giftSpawnRole,
	'harvester': harvesterSpawnRole,
	'harvester.minerals': mineralHarvesterSpawnRole,
	'harvester.power': powerHarvesterSpawnRole,
	'harvester.remote': remoteHarvesrterSpawnRole,
	'hauler': haulerSpawnRole,
	'hauler.power': powerHaulerSpawnRole,
	'helper': helperSpawnRole,
	'room-defense': roomDefenseSpawnRole,
	'scout': scoutSpawnRole,
	'squad': squadSpawnRole,
	'transporter': transporterSpawnRole,
	'upgrader': upgraderSpawnRole,
};
const historyChunkLength = 100;
const maxHistoryChunks = 20;

export default class ManageSpawnsProcess extends Process {
	room: Room;
	spawnManager: SpawnManager;

	/**
	 * Runs reactions in a room's labs.
	 * @constructor
	 *
	 * @param {object} params
	 *   Options on how to run this process.
	 * @param {object} data
	 *   Memory object allocated for this process' stats.
	 */
	constructor(params, data) {
		super(params, data);
		this.room = params.room;

		this.spawnManager = new SpawnManager();
		for (const roleName in spawnClasses) {
			this.spawnManager.registerSpawnRole(roleName, new spawnClasses[roleName]());
		}
	}

	/**
	 * Manages a room's spawns.
	 */
	run() {
		const roomSpawns = _.filter(Game.spawns, spawn => spawn.pos.roomName === this.room.name && spawn.isOperational());
		this.visualizeSpawning(roomSpawns);
		this.spawnManager.manageSpawns(this.room, roomSpawns);
		this.collectSpawnStats(roomSpawns);
	}

	/**
	 * Collects stats for each spawn in memory.
	 */
	collectSpawnStats(spawns) {
		if (!this.room.memory.spawns) this.room.memory.spawns = {};
		const memory = this.room.memory.spawns;

		for (const spawn of spawns) {
			if (!memory[spawn.id]) {
				memory[spawn.id] = {
					ticks: 0,
					spawning: 0,
					waiting: 0,
					history: [],
					options: 0,
				};
			}

			const spawnMemory = memory[spawn.id];
			spawnMemory.ticks++;
			if (spawn.spawning) spawnMemory.spawning++;
			if (spawn.waiting) spawnMemory.waiting++;
			spawnMemory.options = spawn.numSpawnOptions;

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
	}

	/**
	 * Visualize which creeps are spawning in a room's spawns.
	 *
	 * @param {StructureSpawn[]} spawns
	 *   An array containing the room's spawns.
	 */
	visualizeSpawning(spawns) {
		if (!this.room.visual) return;
		if (!this.room.memory.spawns) return;

		for (const spawn of spawns) {
			// Show spawn usage stats.
			const memory = this.room.memory.spawns[spawn.id] || {ticks: 1, spawning: 0, waiting: 0, history: []};
			const totalTicks = memory.ticks + (memory.history.length * historyChunkLength);
			const spawningTicks = _.reduce(memory.history, (total, h: any) => total + h.spawning, memory.spawning);
			const waitingTicks = _.reduce(memory.history, (total, h: any) => total + h.waiting, memory.waiting);
			this.room.visual.rect(spawn.pos.x - 0.5, spawn.pos.y, 1, 0.3, {fill: '#888888', opacity: 0.5});
			this.room.visual.rect(spawn.pos.x - 0.5, spawn.pos.y, spawningTicks / totalTicks, 0.3, {fill: '#88ff88'});
			this.room.visual.rect(spawn.pos.x - 0.5 + (spawningTicks / totalTicks), spawn.pos.y, waitingTicks / totalTicks, 0.3, {fill: '#ff8888'});

			if (!spawn.spawning) continue;

			// Show name of currently spawning creep.
			this.room.visual.text(spawn.spawning.name, spawn.pos.x + 0.05, spawn.pos.y + 0.65, {
				font: 0.5,
				color: 'black',
			});
			this.room.visual.text(spawn.spawning.name, spawn.pos.x, spawn.pos.y + 0.6, {
				font: 0.5,
			});
		}
	}
}
