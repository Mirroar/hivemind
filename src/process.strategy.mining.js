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
	let max = 0;

	// Determine how much remote mining each room can handle.
	_.each(Game.rooms, room => {
		if (!room.controller || !room.controller.my) return;

		const numSpawns = _.filter(Game.spawns, spawn => spawn.pos.roomName === room.name && spawn.isOperational()).length;
		if (numSpawns === 0) return;

		max += 2 * numSpawns;

		sourceRooms[room.name] = {
			current: 0,
			max: 2 * numSpawns,
		};
	});

	// Create ordered list of best harvest rooms.
	const harvestRooms = [];
	_.each(memory.roomList, info => {
		if (!info.harvestPriority || info.harvestPriority <= 0.1) return;

		info.harvestActive = false;
		harvestRooms.push(info);
	});

	const sortedRooms = _.sortBy(harvestRooms, info => -info.harvestPriority);

	// Decide which are active.
	let total = 0;
	for (let i = 0; i < sortedRooms.length; i++) {
		const info = sortedRooms[i];
		if (!sourceRooms[info.origin]) continue;
		if (sourceRooms[info.origin].current >= sourceRooms[info.origin].max) continue;

		sourceRooms[info.origin].current++;
		info.harvestActive = true;

		total++;
		if (total >= memory.remoteHarvesting.currentCount) break;
	}

	// Adjust remote harvesting number according to cpu.
	if (Game.time - memory.remoteHarvesting.lastCheck >= 1000) {
		memory.remoteHarvesting.lastCheck = Game.time;

		if (stats.getStat('bucket', 10000)) {
			if (stats.getStat('bucket', 10000) >= 9500 && stats.getStat('bucket', 1000) >= 9500 && stats.getStat('cpu_total', 1000) <= 0.9 * Game.cpu.limit) {
				if (memory.remoteHarvesting.currentCount < max) {
					memory.remoteHarvesting.currentCount++;
				}
			}
			else if (stats.getStat('bucket', 1000) <= 8000) {
				if (memory.remoteHarvesting.currentCount > 0) {
					memory.remoteHarvesting.currentCount--;
				}
			}
		}
	}

	// @todo Reduce remote harvesting if we want to expand.
};

module.exports = RemoteMiningProcess;
