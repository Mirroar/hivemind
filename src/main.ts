/* global RawMemory */

declare global {
	interface RoomMemory {
		bays?: any,
		sources?: any,
		minerals?: any,
		structureCache?: any,
		remoteHarvesting?: any,
	}

	interface RawMemory {
		_parsed,
	}

	namespace NodeJS {
		interface Global {
			Memory: Memory,
			hivemind: typeof hivemind,
		}
	}

	const _: typeof _;
}

// Make sure game object prototypes are enhanced.
import { ErrorMapper } from "utils/ErrorMapper";

import './prototype/construction-site';
import './prototype/creep';
import './prototype/room';
import './prototype/structure';

console.log('new global reset');

// Create kernel object.
import {PROCESS_PRIORITY_ALWAYS, PROCESS_PRIORITY_LOW, PROCESS_PRIORITY_HIGH} from 'hivemind';
import hivemind from 'hivemind';
global.hivemind = hivemind;
import RoomIntel from 'room-intel';
import SegmentedMemory from 'utils/segmented-memory';
import utilities from 'utilities';
hivemind.setSegmentedMemory(new SegmentedMemory());
hivemind.setRoomIntelClass(RoomIntel);
hivemind.setUtilities(utilities);
hivemind.logGlobalReset();

// Load top-level processes.
import CleanupProcess from 'process/cleanup';
import CreepsProcess from 'process/creeps';
import ExpandProcess from 'process/strategy/expand';
import InitProcess from 'process/init';
import interShard from 'intershard';
import InterShardProcess from 'process/strategy/intershard';
import ManagePowerCreepsProcess from 'process/power-creeps/manage';
import MapVisualsProcess from 'process/map-visuals';
import PowerMiningProcess from 'process/strategy/power';
import ReclaimProcess from 'process/strategy/reclaim';
import RemoteMiningProcess from 'process/strategy/mining';
import ReportProcess from 'process/report';
import ResourcesProcess from 'process/resources';
import RoomsProcess from 'process/rooms';
import ScoutProcess from 'process/strategy/scout';
import SpawnPowerCreepsProcess from 'process/power-creeps/spawn';
import TradeProcess from 'process/trade';

/* eslint-disable import/no-unassigned-import */
import './manager.military';
import './manager.source';
/* eslint-enable import/no-unassigned-import */

import cache from 'utils/cache';

// Allow profiling of code.
import {profiler, useProfiler} from 'utils/profiler';
import stats from 'utils/stats';

// @todo Add a healer to defender squads, or spawn one when creeps are injured.

// @todo make unarmed creeps run from hostiles.

// @todo Spawn creeps using "sequences" where more control is needed.

const main = {

	/**
	 * Wrapper for main game loop to optionally use profiler.
	 */
	loop() {
		if (useProfiler) {
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
		this.useMemoryFromHeap();

		hivemind.segmentMemory.manage();

		if (hivemind.migrateData()) return;

		hivemind.onTickStart();

		this.cleanup();

		hivemind.runProcess('init', InitProcess, {
			priority: PROCESS_PRIORITY_ALWAYS,
		});

		const interShardMemory = interShard.getLocalMemory();
		const shardHasRooms = interShardMemory.info && interShardMemory.info.ownedRooms > 0;
		const shardHasEstablishedRooms = shardHasRooms && interShardMemory.info.maxRoomLevel > 3;

		hivemind.runProcess('creeps', CreepsProcess, {
			priority: PROCESS_PRIORITY_ALWAYS,
		});

		hivemind.runProcess('rooms', RoomsProcess, {
			priority: PROCESS_PRIORITY_ALWAYS,
		});
		hivemind.runProcess('strategy.scout', ScoutProcess, {
			interval: hivemind.settings.get('scoutProcessInterval'),
			priority: PROCESS_PRIORITY_LOW,
			requireSegments: true,
		});

		if (shardHasEstablishedRooms) {
			// @todo This process could be split up - decisions about when and where to expand can be executed at low priority. But management of actual expansions is high priority.
			hivemind.runProcess('strategy.expand', ExpandProcess, {
				interval: Memory.hivemind.canExpand ? 5 : 50,
				priority: PROCESS_PRIORITY_HIGH,
			});
		}

		if (shardHasRooms) {
			hivemind.runProcess('strategy.remote_mining', RemoteMiningProcess, {
				interval: 100,
			});

			hivemind.runProcess('cleanup', CleanupProcess, {
				interval: 100,
				priority: PROCESS_PRIORITY_LOW,
				requireSegments: true,
			});
		}

		if (shardHasEstablishedRooms) {
			hivemind.runProcess('strategy.power_mining', PowerMiningProcess, {
				interval: hivemind.settings.get('powerMiningCheckInterval'),
			});

			hivemind.runProcess('strategy.reclaim', ReclaimProcess, {
				interval: 100,
				priority: PROCESS_PRIORITY_LOW,
			});
		}

		hivemind.runProcess('strategy.inter_shard', InterShardProcess, {
			interval: 100,
			priority: PROCESS_PRIORITY_LOW,
		});

		if (shardHasEstablishedRooms) {
			hivemind.runProcess('empire.trade', TradeProcess, {
				interval: 50,
				priority: PROCESS_PRIORITY_LOW,
			});
			hivemind.runProcess('empire.resources', ResourcesProcess, {
				interval: 50,
			});
		}

		hivemind.runProcess('empire.report', ReportProcess, {
			interval: 100,
		});
		hivemind.runProcess('empire.power_creeps.manage', ManagePowerCreepsProcess, {
			interval: 100,
		});
		hivemind.runProcess('empire.power_creeps.spawn', SpawnPowerCreepsProcess, {
			interval: 100,
		});
		hivemind.runProcess('map-visuals', MapVisualsProcess, {
			priority: PROCESS_PRIORITY_ALWAYS,
		});

		this.showDebug();
		this.recordStats();
	},

	lastTime: 0,
	lastMemory: null,
	useMemoryFromHeap() {
		if (this.lastTime && this.lastMemory && Game.time === this.lastTime + 1) {
			delete global.Memory;
			global.Memory = this.lastMemory;
			RawMemory._parsed = this.lastMemory;
		}
		else {
			// Force parsing of Memory.
			// eslint-disable-next-line no-unused-expressions
			Memory.rooms;
			this.lastMemory = RawMemory._parsed;
		}

		this.lastTime = Game.time;
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
		if (Game.time % 3738 === 2100 && hivemind.segmentMemory.isReady()) {
			let count = 0;
			_.each(Memory.rooms, (memory, roomName) => {
				if (hivemind.roomIntel(roomName).getAge() > 100000) {
					delete Memory.rooms[roomName];
					count++;
				}
			});

			if (count > 0) {
				hivemind.log('main').debug('Pruned old memory for', count, 'rooms.');
			}
		}

		// @todo Periodically clean old room intel from segment memory.
		// @todo Periodically clean old room planner from segment memory.

		// Periodically clean old squad memory.
		if (Game.time % 548 === 3) {
			_.each(Memory.squads, (memory, squadName) => {
				// Only delete if squad can't be spawned.
				if (memory.spawnRoom && Game.rooms[memory.spawnRoom]) return;

				// Don't delete inter-shard squad that can't have a spawn room.
				if (squadName === 'interShardExpansion') return;

				// Only delete if there are no creeps belonging to this squad.
				if (_.size(_.filter(Game.creeps, creep => creep.memory.squadName === squadName)) > 0) return;

				delete Memory.squads[squadName];
			});
		}

		// Periodically garbage collect in caches.
		if (Game.time % 253 === 0) {
			cache.collectGarbage();
			cache.collectGarbage(Memory);
		}

		// Periodically clean memory that is no longer needed.
		if (Game.time % 1234 === 56) {
			_.each(Memory.rooms, roomMemory => {
				delete roomMemory.bays;
				delete roomMemory.sources;
				delete roomMemory.minerals;
				delete roomMemory.structureCache;
				delete roomMemory.remoteHarvesting;
			});
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

export const loop = ErrorMapper.wrapLoop(() => {
	main.loop();
});
