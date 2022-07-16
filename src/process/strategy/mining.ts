/* global PWR_OPERATE_SPAWN POWER_INFO */

import Process from 'process/process';

import RemoteMiningOperation from 'operation/remote-mining';
import stats from 'utils/stats';

declare global {
	interface StrategyMemory {
		remoteHarvesting?: {
			currentCount: number;
			lastCheck: number;
			rooms: string[];
		};
	}
}

export default class RemoteMiningProcess extends Process {
	/**
	 * Manages which and how many rooms may be remotely mined.
	 * @constructor
	 *
	 * @param {object} parameters
	 *   Options on how to run this process.
	 */
	constructor(parameters: ProcessParameters) {
		super(parameters);

		if (!Memory.strategy) {
			Memory.strategy = {};
		}

		if (!Memory.strategy.remoteHarvesting) {
			// Try starting with 2.
			Memory.strategy.remoteHarvesting = {
				currentCount: 20,
				lastCheck: Game.time,
				rooms: [],
			};
		}
	}

	/**
	 * Determines optimal number of remote mining rooms based on CPU and expansion
	 * plans.
	 */
	run() {
		const memory = Memory.strategy;
		const sourceRooms = {};
		memory.remoteHarvesting.rooms = [];

		// Determine how much remote mining each room can handle.
		for (const room of Game.myRooms) {
			// Start remote mining as early as RCL 2, even in first room.
			if (_.size(Game.spawns) === 1 && _.sample(Game.spawns).room.name === room.name && room.controller.level < 2) continue;

			let spawnCount = _.filter(Game.spawns, spawn => spawn.pos.roomName === room.name && spawn.isOperational()).length;
			if (spawnCount === 0) {
				if (room.controller.level > 3 && room.controller.level < 7) {
					// It's possible we're only moving the room's only spawn to a different
					// location. Treat room as having one spawn so we can resume when it
					// has been rebuilt.
					spawnCount = 1;
				}
				else {
					continue;
				}
			}

			// @todo Actually calculate spawn usage for each.
			let spawnCapacity = spawnCount * 5;
			const exploitFlags = _.filter(Game.flags, flag => flag.name.startsWith('Exploit:' + room.name + ':'));
			const roomNeeds = room.controller.level < 4 ? 1 : (room.controller.level < 6 ? 2 : 4) + (room.controller.level >= 7 ? exploitFlags.length * 3 : 0);

			// Increase spawn capacity if there's a power creep that can help.
			const powerCreep = _.find(Game.powerCreeps, creep => {
				if (!creep.shard) return false;
				if (creep.shard !== Game.shard.name) return false;
				if (creep.pos.roomName !== room.name) return false;

				return true;
			});
			if (powerCreep) {
				const operateSpawnLevel = (powerCreep.powers[PWR_OPERATE_SPAWN] || {}).level || 0;
				if (operateSpawnLevel > 0) spawnCapacity /= POWER_INFO[PWR_OPERATE_SPAWN].effect[operateSpawnLevel - 1];
			}

			sourceRooms[room.name] = {
				current: 0,
				max: Math.floor(spawnCapacity - roomNeeds),
			};
		}

		// Create ordered list of best harvest rooms.
		// @todo At this point we should carry duplicate for rooms that could have
		// multiple origins.
		const harvestRooms = [];
		_.each(memory.roomList, info => {
			// Ignore rooms that are not profitable to harvest from.
			if (!info.harvestPriority || info.harvestPriority <= 0.1) return;

			// Ignore rooms we can not reach safely.
			if (!info.safePath) return;

			harvestRooms.push(info);
		});

		const sortedRooms = _.sortBy(harvestRooms, info => -info.harvestPriority);

		// Decide which harvest rooms are active.
		let availableHarvestRoomCount = 0;
		for (const info of sortedRooms) {
			if (!sourceRooms[info.origin]) continue;

			if (sourceRooms[info.origin].current >= sourceRooms[info.origin].max) continue;
			sourceRooms[info.origin].current++;

			if (availableHarvestRoomCount < memory.remoteHarvesting.currentCount) {
				// Disregard rooms the user doesn't want harvested.
				const roomFilter = hivemind.settings.get<(roomName: string) => boolean>('remoteMineRoomFilter');
				if (roomFilter && !roomFilter(info.roomName)) continue;

				// Harvest from this room.
				memory.remoteHarvesting.rooms.push(info.roomName);
			}

			availableHarvestRoomCount++;
		}

		this.adjustRemoteMiningCount(availableHarvestRoomCount);
		this.manageOperations();

		// @todo Reduce remote harvesting if we want to expand.
	}

	/**
	 * Periodically Adjusts remote harvesting room count.
	 *
	 * @param {number} availableHarvestRoomCount
	 *   Maximum number of harvest rooms that might be used.
	 */
	adjustRemoteMiningCount(availableHarvestRoomCount) {
		const memory = Memory.strategy;

		if (!memory.remoteHarvesting.lastCheck || !hivemind.hasIntervalPassed(1000, memory.remoteHarvesting.lastCheck)) return;

		memory.remoteHarvesting.lastCheck = Game.time;

		if (Game.myRooms.length < 3) {
			// Early game, make sure to remote mine as much as possible for a
			// quick start.
			memory.remoteHarvesting.currentCount = 20;
			return;
		}

		// Reduce count if we are over the available maximum.
		if (memory.remoteHarvesting.currentCount > availableHarvestRoomCount) {
			Game.notify('⚒ reduced remote mining count from ' + memory.remoteHarvesting.currentCount + ' to ' + availableHarvestRoomCount + ' because that is the maximum number of available rooms.');
			memory.remoteHarvesting.currentCount = availableHarvestRoomCount;
		}

		// Check past CPU and bucket usage.
		const longTermBucket = stats.getStat('bucket', 10_000) || 10_000;
		const shortTermBucket = stats.getStat('bucket', 1000) || 10_000;
		const cpuUsage = stats.getStat('cpu_total', 1000) || 0.5;
		if (longTermBucket >= 9500 && shortTermBucket >= 9500 && cpuUsage <= 0.95 * Game.cpu.limit) {
			// We've been having bucket reserves and CPU cycles to spare.
			if (memory.remoteHarvesting.currentCount < availableHarvestRoomCount) {
				memory.remoteHarvesting.currentCount++;
			}
		}
		else if (shortTermBucket <= 8000) {
			// Bucket has seen some usage recently.
			if (memory.remoteHarvesting.currentCount > 0) {
				memory.remoteHarvesting.currentCount--;
			}
		}
	}

	/**
	 * Creates or terminates remote mining operations based on selected rooms.
	 */
	manageOperations() {
		const memory = Memory.strategy;

		// Create operations for selected rooms.
		for (const roomName of memory.remoteHarvesting.rooms) {
			if (!Game.operationsByType.mining['mine:' + roomName]) {
				const operation = new RemoteMiningOperation('mine:' + roomName);
				operation.setRoom(roomName);
			}
		}

		// Stop operations for rooms that are no longer selected.
		_.each(Game.operationsByType.mining, op => {
			if (!memory.remoteHarvesting.rooms.includes(op.getRoom())) {
				op.terminate();
			}
		});
	}
}
