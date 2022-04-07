declare global {
	interface StructureSpawn {
		heapMemory: SpawnHeapMemory;
	}

	interface SpawnHeapMemory extends StructureHeapMemory {
		ticks: number;
		spawning: number;
		waiting: number;
		options: number;
		history: HistorySegment[];
	}
}

type HistorySegment = {
	ticks: number;
	spawning: number;
	waiting: number;
}

import hivemind from 'hivemind';
import Process from 'process/process';
import SpawnManager from 'spawn-manager';

import brawlerSpawnRole from 'spawn-role/brawler';
import builderSpawnRole from 'spawn-role/builder';
import caravanTraderSpawnRole from 'spawn-role/caravan-trader';
import claimerSpawnRole from 'spawn-role/claimer';
import depositHarvesterSpawnRole from 'spawn-role/harvester.deposit';
import dismantlerSpawnRole from 'spawn-role/dismantler';
import exploitSpawnRole from 'spawn-role/exploit';
import gathererSpawnRole from 'spawn-role/gatherer';
import giftSpawnRole from 'spawn-role/gift';
import harvesterSpawnRole from 'spawn-role/harvester';
import haulerSpawnRole from 'spawn-role/hauler';
import helperSpawnRole from 'spawn-role/helper';
import mineralHarvesterSpawnRole from 'spawn-role/harvester.minerals';
import muleSpawnRole from 'spawn-role/mule';
import powerHarvesterSpawnRole from 'spawn-role/harvester.power';
import powerHaulerSpawnRole from 'spawn-role/hauler.power';
import reclaimSpawnRole from 'spawn-role/reclaim';
import remoteHarvesterSpawnRole from 'spawn-role/harvester.remote';
import roomDefenseSpawnRole from 'spawn-role/room-defense';
import scoutSpawnRole from 'spawn-role/scout';
import squadSpawnRole from 'spawn-role/squad';
import transporterSpawnRole from 'spawn-role/transporter';
import upgraderSpawnRole from 'spawn-role/upgrader';

const spawnClasses = {
	'brawler': brawlerSpawnRole,
	'builder': builderSpawnRole,
	'caravan-trader': caravanTraderSpawnRole,
	'claimer': claimerSpawnRole,
	'dismantler': dismantlerSpawnRole,
	'exploit': exploitSpawnRole,
	'gatherer': gathererSpawnRole,
	'gift': giftSpawnRole,
	'harvester': harvesterSpawnRole,
	'harvester.deposit': depositHarvesterSpawnRole,
	'harvester.minerals': mineralHarvesterSpawnRole,
	'harvester.power': powerHarvesterSpawnRole,
	'harvester.remote': remoteHarvesterSpawnRole,
	'hauler': haulerSpawnRole,
	'hauler.power': powerHaulerSpawnRole,
	'helper': helperSpawnRole,
	'mule': muleSpawnRole,
	'reclaim': reclaimSpawnRole,
	'room-defense': roomDefenseSpawnRole,
	'scout': scoutSpawnRole,
	'squad': squadSpawnRole,
	'transporter': transporterSpawnRole,
	'upgrader': upgraderSpawnRole,
};
const historyChunkLength = 200;
const maxHistoryChunks = 10;

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
	collectSpawnStats(spawns: StructureSpawn[]) {
		for (const spawn of spawns) {
			if (!spawn.heapMemory.history) {
				spawn.heapMemory.ticks = 0;
				spawn.heapMemory.spawning = 0;
				spawn.heapMemory.waiting = 0;
				spawn.heapMemory.history = [];
				spawn.heapMemory.options = 0;
			}

			spawn.heapMemory.ticks++;
			if (spawn.spawning) spawn.heapMemory.spawning++;
			if (spawn.waiting) spawn.heapMemory.waiting++;
			spawn.heapMemory.options = spawn.numSpawnOptions;

			if (spawn.heapMemory.ticks >= historyChunkLength) {
				// Save current history as new chunk.
				spawn.heapMemory.history.push({
					ticks: spawn.heapMemory.ticks,
					spawning: spawn.heapMemory.spawning,
					waiting: spawn.heapMemory.waiting,
				});
				spawn.heapMemory.history = spawn.heapMemory.history.slice(-maxHistoryChunks);

				// Also record to room stats if enabled.
				if (hivemind.settings.get('recordRoomStats') && Memory.roomStats[spawn.room.name]) {
					Memory.roomStats[spawn.room.name]['RCL' + spawn.room.controller.level + 'SpawnSpawning'] = (Memory.roomStats[spawn.room.name]['RCL' + spawn.room.controller.level + 'SpawnSpawning'] || 0) + spawn.heapMemory.spawning;
					Memory.roomStats[spawn.room.name]['RCL' + spawn.room.controller.level + 'SpawnWaiting'] = (Memory.roomStats[spawn.room.name]['RCL' + spawn.room.controller.level + 'SpawnWaiting'] || 0) + spawn.heapMemory.waiting;
					Memory.roomStats[spawn.room.name]['RCL' + spawn.room.controller.level + 'SpawnIdle'] = (Memory.roomStats[spawn.room.name]['RCL' + spawn.room.controller.level + 'SpawnIdle'] || 0) + spawn.heapMemory.ticks - spawn.heapMemory.waiting - spawn.heapMemory.spawning;
					Memory.roomStats[spawn.room.name]['RCL' + spawn.room.controller.level + 'SpawnTotalTicks'] = (Memory.roomStats[spawn.room.name]['RCL' + spawn.room.controller.level + 'SpawnTotalTicks'] || 0) + spawn.heapMemory.ticks;
				}

				// Reset current history values.
				spawn.heapMemory.ticks = 0;
				spawn.heapMemory.spawning = 0;
				spawn.heapMemory.waiting = 0;
			}
		}
	}

	/**
	 * Visualize which creeps are spawning in a room's spawns.
	 *
	 * @param {StructureSpawn[]} spawns
	 *   An array containing the room's spawns.
	 */
	visualizeSpawning(spawns: StructureSpawn[]) {
		if (!this.room.visual) return;

		for (const spawn of spawns) {
			// Show spawn usage stats.
			const memory = spawn.heapMemory || {ticks: 1, spawning: 0, waiting: 0, history: []};
			const totalTicks = memory.ticks + _.sum(memory.history, h => h.ticks);
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
