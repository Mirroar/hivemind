'use strict';

const Process = require('./process');
const stats = require('./stats');

/**
 * Manages which and how many rooms may be remotely mined.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const RemoteMiningProcess = function (params, data) {
	Process.call(this, params, data);

	if (!Memory.strategy) {
		Memory.strategy = {};
	}

	if (!Memory.strategy.remoteHarvesting) {
		// Try starting with 2.
		Memory.strategy.remoteHarvesting = {
			currentCount: 2,
			lastCheck: Game.time,
		};
	}
};

RemoteMiningProcess.prototype = Object.create(Process.prototype);

/**
 * Determines optimal number of remote mining rooms based on CPU and expansion
 * plans.
 */
RemoteMiningProcess.prototype.run = function () {
	const memory = Memory.strategy;
	const sourceRooms = {};

	// Determine how much remote mining each room can handle.
	_.each(Game.rooms, room => {
		if (!room.isMine()) return;

		// Start remote mining as early as RCL 2, even in first room.
		if (_.size(Game.spawns) === 1 && _.sample(Game.spawns).room.name === room.name && room.controller.level < 2) return;

		const numSpawns = _.filter(Game.spawns, spawn => spawn.pos.roomName === room.name && spawn.isOperational()).length;
		if (numSpawns === 0) return;

		sourceRooms[room.name] = {
			current: 0,
			max: 2 * numSpawns,
		};
	});

	// Create ordered list of best harvest rooms.
	// @todo At this point we should carry duplicate for rooms that could have
	// multiple origins.
	const harvestRooms = [];
	_.each(memory.roomList, info => {
		info.harvestActive = false;

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
			// Harvest from this room.
			info.harvestActive = true;
		}

		availableHarvestRoomCount++;
	}

	// Adjust remote harvesting number periodically.
	if (Game.time - memory.remoteHarvesting.lastCheck >= 1000) {
		memory.remoteHarvesting.lastCheck = Game.time;

		// Reduce count if we are over the available maximum.
		if (memory.remoteHarvesting.currentCount > availableHarvestRoomCount) {
			Game.notify('⚒ reduced remote mining count from ' + memory.remoteHarvesting.currentCount + ' to ' + availableHarvestRoomCount + ' because that is the maximum number of available rooms.');
			memory.remoteHarvesting.currentCount = availableHarvestRoomCount;
		}

		// Check past CPU and bucket usage.
		if (stats.getStat('bucket', 10000)) {
			if (stats.getStat('bucket', 10000) >= 9500 && stats.getStat('bucket', 1000) >= 9500 && stats.getStat('cpu_total', 1000) <= 0.95 * Game.cpu.limit) {
				// We've been having bucket reserves and CPU cycles to spare.
				if (memory.remoteHarvesting.currentCount < availableHarvestRoomCount) {
					memory.remoteHarvesting.currentCount++;
				}
			}
			else if (stats.getStat('bucket', 1000) <= 8000) {
				// Bucket has seen some usage recently.
				if (memory.remoteHarvesting.currentCount > 0) {
					memory.remoteHarvesting.currentCount--;
				}
			}
		}
	}

	// @todo Reduce remote harvesting if we want to expand.
};

module.exports = RemoteMiningProcess;
