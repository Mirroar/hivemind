'use strict';

/* global hivemind RawMemory PROCESS_PRIORITY_ALWAYS PROCESS_PRIORITY_LOW
PROCESS_PRIORITY_HIGH */

// Make sure game object prototypes are enhanced.
require('./prototype.construction-site');
require('./prototype.creep');
require('./prototype.room');
require('./prototype.structure');

console.log('new global reset');

// Create kernel object.
const Hivemind = require('./hivemind');

global.hivemind = new Hivemind();

// Load top-level processes.
const CreepsProcess = require('./process.creeps');
const ExpandProcess = require('./process.strategy.expand');
const InitProcess = require('./process.init');
const InterShardProcess = require('./process.strategy.intershard');
const PowerMiningProcess = require('./process.strategy.power');
const RemoteMiningProcess = require('./process.strategy.mining');
const ReportProcess = require('./process.empire.report');
const ResourcesProcess = require('./process.empire.resources');
const RoomsProcess = require('./process.rooms');
const ScoutProcess = require('./process.strategy.scout');
const TradeProcess = require('./process.empire.trade');

/* eslint-disable import/no-unassigned-import */
require('./manager.military');
require('./manager.source');
/* eslint-enable import/no-unassigned-import */

// Allow profiling of code.
const profiler = require('./profiler');
const stats = require('./stats');

// @todo Add a healer to defender squads, or spawn one when creeps are injured.

// @todo Do not send any remote harvesters or claimers until enemies in a room should have expired. Maybe scout from time to time.
// @todo make unarmed creeps run from hostiles.

// @todo Spawn creeps using "sequences" where more control is needed.

module.exports = {

	/**
	 * Wrapper for main game loop to optionally use profiler.
	 */
	loop() {
		if (profiler) {
			profiler.wrap(this.runTick);
		}
		else {
			this.runTick();
		}
	},

	/**
	 * Runs main game loop.
	 */
	runTick() {
		if (Memory.isAccountThrottled) {
			Game.cpu.limit = 20;
		}

		hivemind.onTickStart();

		this.cleanup();

		hivemind.runProcess('init', InitProcess, {
			priority: PROCESS_PRIORITY_ALWAYS,
		});

		hivemind.runProcess('creeps', CreepsProcess, {
			priority: PROCESS_PRIORITY_ALWAYS,
		});

		hivemind.runProcess('rooms', RoomsProcess, {
			priority: PROCESS_PRIORITY_ALWAYS,
		});
		hivemind.runProcess('strategy.scout', ScoutProcess, {
			interval: 50,
			priority: PROCESS_PRIORITY_LOW,
		});
		// @todo This process could be split up - decisions about when and where to expand can be executed at low priority. But management of actual expansions is high priority.
		hivemind.runProcess('strategy.expand', ExpandProcess, {
			interval: 50,
			priority: PROCESS_PRIORITY_HIGH,
		});
		hivemind.runProcess('strategy.remote_mining', RemoteMiningProcess, {
			interval: 100,
		});
		hivemind.runProcess('strategy.power_mining', PowerMiningProcess, {
			interval: 100,
		});
		hivemind.runProcess('strategy.inter_shard', InterShardProcess, {
			interval: 100,
			priority: PROCESS_PRIORITY_LOW,
		});

		hivemind.runProcess('empire.trade', TradeProcess, {
			interval: 50,
			priority: PROCESS_PRIORITY_LOW,
		});
		hivemind.runProcess('empire.resources', ResourcesProcess, {
			interval: 50,
		});
		hivemind.runProcess('empire.report', ReportProcess, {
			interval: 100,
		});

		this.recordStats();
		this.showDebug();
	},

	/**
	 * Saves CPU stats for the current tick to memory.
	 */
	recordStats() {
		if (Game.time % 10 === 0 && Game.cpu.bucket < 9800) {
			hivemind.log('main').info('Bucket:', Game.cpu.bucket);
		}

		const time = Game.cpu.getUsed();

		if (time > Game.cpu.limit * 1.2) {
			hivemind.log('cpu').info('High CPU:', time + '/' + Game.cpu.limit);
		}

		stats.recordStat('cpu_total', time);
		stats.recordStat('bucket', Game.cpu.bucket);
		stats.recordStat('creeps', _.size(Game.creeps));
	},

	/**
	 * Periodically deletes unused data from memory.
	 */
	cleanup() {
		// Periodically clean creep memory.
		if (Game.time % 16 === 7) {
			for (const name in Memory.creeps) {
				if (!Game.creeps[name]) {
					delete Memory.creeps[name];
				}
			}
		}

		// Periodically clean flag memory.
		if (Game.time % 1000 === 725) {
			for (const flagName in Memory.flags) {
				if (!Game.flags[flagName]) {
					delete Memory.flags[flagName];
				}
			}
		}

		// Check if memory is getting too bloated.
		const usedMemory = RawMemory.get().length;
		if (Game.time % 7836 === 0 || usedMemory > 2000000) {
			const currentScoutDistance = Memory.hivemind.maxScoutDistance || 7;
			if (usedMemory > 1800000 && currentScoutDistance > 2) {
				Memory.hivemind.maxScoutDistance = currentScoutDistance - 1;
				for (const roomName in Memory.strategy.roomList) {
					if (Memory.strategy.roomList[roomName].range > Memory.hivemind.maxScoutDistance) {
						delete Memory.rooms[roomName];
						delete Memory.strategy.roomList[roomName];
					}
				}
			}
			else if (usedMemory < 1500000 && currentScoutDistance < 10) {
				Memory.hivemind.maxScoutDistance = currentScoutDistance + 1;
			}
		}

		// Periodically clean old room memory.
		if (Game.time % 3738 === 2100) {
			let count = 0;
			_.each(Memory.rooms, (memory, roomName) => {
				if (hivemind.roomIntel(roomName).getAge() > 100000) {
					delete Memory.rooms[roomName];
					count++;
					return;
				}

				if (memory.roomPlanner && (!Game.rooms[roomName] || !Game.rooms[roomName].isMine())) {
					delete memory.roomPlanner;
					count++;
				}
			});

			if (count > 0) {
				hivemind.log('main').debug('Pruned old memory for', count, 'rooms.');
			}
		}
	},

	/**
	 *
	 */
	showDebug() {
		if ((Memory.hivemind.showProcessDebug || 0) > 0) {
			Memory.hivemind.showProcessDebug--;
			hivemind.drawProcessDebug();
		}
	},

};
