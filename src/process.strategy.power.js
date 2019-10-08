'use strict';

/* global hivemind CREEP_SPAWN_TIME MAX_CREEP_SIZE CONTROLLER_STRUCTURES
STRUCTURE_POWER_SPAWN ERR_NO_PATH ATTACK_POWER */

const Process = require('./process');

/**
 * Decides on power sources to attack and loot.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const PowerMiningProcess = function (params, data) {
	Process.call(this, params, data);

	if (!Memory.strategy) {
		Memory.strategy = {};
	}

	if (!Memory.strategy.power) {
		Memory.strategy.power = {};
	}
};

PowerMiningProcess.prototype = Object.create(Process.prototype);

/**
 * Decides whether this process is allowed to run.
 *
 * @return {boolean}
 *   True if power harvesting is enabled.
 */
PowerMiningProcess.prototype.shouldRun = function () {
	if (!Process.prototype.shouldRun.call(this)) return false;
	if (Memory.disablePowerHarvesting) return false;

	return true;
};

/**
 * Analizes the power banks detected by intel, to decide which and how to attack.
 */
PowerMiningProcess.prototype.run = function () {
	// @todo Add throttle like with remote harvesting.
	const memory = Memory.strategy.power;

	_.each(memory.rooms, (info, roomName) => {
		// @todo Skip room if we already decided to harvest it.
		// Calculate DPS we'd need to do to harvest this power.
		let timeRemaining = info.decays - Game.time;

		if (info.isActive) {
			// No need to modify this information.
			if (timeRemaining <= 0) {
				delete memory.rooms[roomName];
			}

			return;
		}

		// Substract time we need to spawn first set of attackers.
		timeRemaining -= CREEP_SPAWN_TIME * MAX_CREEP_SIZE;

		// Substract extra time until spawns are ready to generate our creeps.
		timeRemaining -= CREEP_SPAWN_TIME * MAX_CREEP_SIZE * 2 / 3;

		if (timeRemaining <= 0) {
			delete memory.rooms[roomName];
			return;
		}

		const dps = info.hits / timeRemaining;

		// @todo Maybe adjust strategy to use dedicated attackers and healers if space is limited.

		const partsPerDPS = 2 / ATTACK_POWER;
		const numCreeps = Math.ceil(dps * partsPerDPS / MAX_CREEP_SIZE);

		if (numCreeps > Math.min(5, info.freeTiles)) {
			delete memory.rooms[roomName];
			return;
		}

		hivemind.log('strategy').debug('Gathering ' + info.amount + ' power in ' + roomName + ' would need ' + dps + ' DPS, or ' + numCreeps + ' attack creeps.');

		// Determine which rooms need to spawn creeps.
		let potentialSpawns = [];
		_.each(Game.rooms, room => {
			if (!room.isMine()) return;
			if (room.isFullOnPower()) return;
			if (room.getStoredEnergy() < 75000) return;
			if (CONTROLLER_STRUCTURES[STRUCTURE_POWER_SPAWN][room.controller.level] < 1) return;
			if (Game.map.getRoomLinearDistance(roomName, room.name) > 5) return;

			const roomRoute = Game.map.findRoute(room.name, roomName);
			if (roomRoute === ERR_NO_PATH || roomRoute.length > 10) return;

			hivemind.log('strategy').debug('Could spawn creeps in', room.name, 'with distance', roomRoute.length);

			potentialSpawns.push({
				room: room.name,
				distance: roomRoute.length,
			});
		});

		potentialSpawns = _.sortBy(potentialSpawns, 'distance');

		// Substract travel time until all attackers could be there.
		let maxAttackers = 0;
		let travelTime = 0;
		let failed = true;
		const neededRooms = {};
		let finalDps = 0;
		for (const spawnInfo of potentialSpawns) {
			maxAttackers += 2;
			// Estimate travel time at 50 ticks per room.
			travelTime = spawnInfo.distance * 50;

			const neededDps = info.hits / (timeRemaining - travelTime);
			// @todo Needed Dps multiplier is this high because currently creeps can only attack every 2 ticks.
			const numCreeps = Math.ceil(neededDps * 1.2 * partsPerDPS / MAX_CREEP_SIZE);

			if (numCreeps > Math.min(6, info.freeTiles)) {
				// Would need too many creeps at this distance.
				break;
			}

			neededRooms[spawnInfo.room] = spawnInfo;

			if (maxAttackers >= numCreeps) {
				// Alright, we can spawn enough creeps!
				finalDps = neededDps;
				failed = false;
				break;
			}
		}

		if (failed) {
			return;
		}

		info.spawnRooms = neededRooms;
		info.maxAttackers = maxAttackers;
		info.isActive = true;
		info.neededDps = finalDps;
		info.dps = maxAttackers * MAX_CREEP_SIZE / partsPerDPS;

		// @todo Record neededRooms and maxAttackers.
		// @todo Calculate number of transporters needed in the end.

		// @todo Start spawning.
		Game.notify('⚡ Gathering ' + (info.amount || 'N/A') + ' power from room ' + roomName + '.');
		hivemind.log('strategy').info('Gathering ' + (info.amount || 'N/A') + ' power from room ' + roomName + '.');
	});
};

module.exports = PowerMiningProcess;
