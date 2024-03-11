/* global RawMemory */

// Make sure game object prototypes are enhanced.
import {ErrorMapper} from 'utils/ErrorMapper';

import './prototype/construction-site';
import './prototype/cost-matrix';
import './prototype/creep';
import './prototype/room';
import './prototype/structure';

// Create kernel object.
import {PROCESS_PRIORITY_ALWAYS, PROCESS_PRIORITY_LOW, PROCESS_PRIORITY_HIGH} from 'hivemind';
import hivemind from 'hivemind';
import SegmentedMemory from 'utils/segmented-memory';

import container from 'utils/container';
import containerSetup from 'container-factory';

import balancer from 'excess-energy-balancer';

import {getRoomIntel, RoomIntelMemory} from 'room-intel';
import {PlayerIntelMemory} from 'player-intel';
import {RoomPlannerMemory} from 'room/planner/room-planner';

// Load top-level processes.
import AlliesProcess from 'process/allies';
import CleanupProcess from 'process/cleanup';
import CreepsProcess from 'process/creeps';
import DepositMiningProcess from 'process/strategy/deposits';
import ExpandProcess from 'process/strategy/expand';
import InitProcess from 'process/init';
import interShard from 'intershard';
import InterShardProcess from 'process/strategy/intershard';
import ManagePowerCreepsProcess from 'process/power-creeps/manage';
import MapVisualsProcess from 'process/map-visuals';
import PlayerIntelProcess from 'process/player-intel';
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
import {clearHeapMemory} from 'prototype/creep';

// Allow profiling of code.
import stats from 'utils/stats';
import {profiler, useProfiler} from 'utils/profiler';

declare global {
	interface RawMemory {
		_parsed: boolean;
	}

	namespace NodeJS {
		interface Global {
			Memory: Memory;
		}
	}

	const _: typeof _;
}

interface DeprecatedRoomMemory extends RoomMemory {
	bays: unknown;
	minerals: unknown;
	remoteHarvesting: unknown;
	roomPlan: unknown;
	sources: unknown;
	spawns: unknown;
	structureCache: unknown;
	inactiveStructures: unknown;
}

console.log('new global reset');

global.hivemind = hivemind;

hivemind.setSegmentedMemory(new SegmentedMemory());
hivemind.logGlobalReset();

containerSetup(container);

balancer.init();

// @todo Add a healer to defender squads, or spawn one when creeps are injured.

// @todo make unarmed creeps run from hostiles.

const main = {

	/**
	 * Wrapper for main game loop to optionally use profiler.
	 */
	loop() {
		if (useProfiler) {
			profiler.wrap(() => this.runTick());
			//this.runTick();
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

		const hook = hivemind.settings.get('onTick');
		if (hook) {
			hook();
		}

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

		const interShardMemory = interShard.getLocalMemory();
		const shardHasRooms = interShardMemory.info && interShardMemory.info.ownedRooms > 0;
		const shardHasEstablishedRooms = shardHasRooms && interShardMemory.info.maxRoomLevel > 3;

		if (shardHasEstablishedRooms) {
			// @todo This process could be split up - decisions about when and where to expand can be executed at low priority. But management of actual expansions is high priority.
			hivemind.runProcess('strategy.expand', ExpandProcess, {
				interval: Memory.hivemind.canExpand ? 5 : 50,
				priority: PROCESS_PRIORITY_HIGH,
			});
		}

		if (shardHasRooms) {
			hivemind.runProcess('strategy.remote_mining', RemoteMiningProcess, {
				interval: _.size(Game.myRooms) === 1 ? 20 : 100,
			});

			hivemind.runProcess('player-intel', PlayerIntelProcess, {
				interval: 100,
				requireSegments: true,
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

			hivemind.runProcess('strategy.deposit_mining', DepositMiningProcess, {
				interval: 100,
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
				interval: 20,
				priority: PROCESS_PRIORITY_LOW,
			});
			hivemind.runProcess('empire.resources', ResourcesProcess, {
				interval: 5,
			});
		}

		hivemind.runProcess('empire.report', ReportProcess, {
			interval: 100,
		});
		hivemind.runProcess('empire.power_creeps.manage', ManagePowerCreepsProcess, {
			interval: hivemind.settings.get('powerCreepUpgradeCheckInterval'),
		});
		hivemind.runProcess('empire.power_creeps.spawn', SpawnPowerCreepsProcess, {
			interval: 100,
		});
		hivemind.runProcess('map-visuals', MapVisualsProcess, {
			priority: PROCESS_PRIORITY_ALWAYS,
		});
		hivemind.runProcess('allies', AlliesProcess, {
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
			clearHeapMemory();
			hivemind.log('memory').debug('Force-parsed memory.');
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
		if (Game.time % 7836 === 0 || usedMemory > 2_000_000) {
			const currentScoutDistance = Memory.hivemind.maxScoutDistance || 7;
			if (usedMemory > 1_800_000 && currentScoutDistance > 2) {
				Memory.hivemind.maxScoutDistance = currentScoutDistance - 1;
				for (const roomName in Memory.strategy.roomList) {
					if (Memory.strategy.roomList[roomName].range > Memory.hivemind.maxScoutDistance) {
						delete Memory.rooms[roomName];
						delete Memory.strategy.roomList[roomName];
					}
				}
			}
			else if (usedMemory < 1_500_000 && currentScoutDistance < 10) {
				Memory.hivemind.maxScoutDistance = currentScoutDistance + 1;
			}
		}

		// Periodically clean old room memory.
		if (Game.time % 3738 === 2100 && hivemind.segmentMemory.isReady()) {
			let count = 0;
			_.each(Memory.rooms, (memory, roomName) => {
				if (getRoomIntel(roomName).getAge() > 100_000) {
					delete Memory.rooms[roomName];
					count++;
				}

				if (memory.observeTargets && !Game.rooms[roomName]?.observer) {
					delete memory.observeTargets;
				}
			});

			if (count > 0) {
				hivemind.log('main').debug('Pruned old memory for', count, 'rooms.');
			}
		}

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
			_.each(Memory.rooms, (roomMemory: DeprecatedRoomMemory) => {
				delete roomMemory.bays;
				delete roomMemory.minerals;
				delete roomMemory.remoteHarvesting;
				delete roomMemory.roomPlan;
				delete roomMemory.sources;
				delete roomMemory.spawns;
				delete roomMemory.structureCache;
				delete roomMemory.inactiveStructures;
			});
		}

		if (Game.time % 3625 == 0 && hivemind.segmentMemory.isReady()) {
			this.cleanupSegmentMemory();
		}
	},

	cleanupSegmentMemory() {
		// Clean old entries from remote path manager from segment memory.
		hivemind.segmentMemory.each<RemotePathMemory>('remotePath:', (key, memory) => {
			if (Game.time - (memory.generated || 0) > 10_000) hivemind.segmentMemory.delete(key);
		});

		// Periodically clean old room intel from segment memory.
		hivemind.segmentMemory.each<RoomIntelMemory>('intel:', (key, memory) => {
			if (Game.time - (memory.lastScan || 0) > 100_000) hivemind.segmentMemory.delete(key);
		});

		// Periodically clean old player intel from segment memory.
		hivemind.segmentMemory.each<PlayerIntelMemory>('u-intel:', (key, memory) => {
			if (Game.time - (memory.lastSeen || 0) > 100_000) hivemind.segmentMemory.delete(key);
		});

		// Periodically clean old room planner from segment memory.
		hivemind.segmentMemory.each<RoomPlannerMemory>('planner:', (key, memory) => {
			const roomName = key.slice(8);
			const isMyRoom = Game.rooms[roomName] && Game.rooms[roomName].isMine();
			if (!isMyRoom || Game.time - (memory.lastRun || 0) > 10_000) hivemind.segmentMemory.delete(key);
		});

		// Periodically clean old room plans from segment memory.
		hivemind.segmentMemory.each('room-plan:', key => {
			const roomName = key.slice(10);
			const isMyRoom = Game.rooms[roomName] && Game.rooms[roomName].isMine();
			if (!isMyRoom) hivemind.segmentMemory.delete(key);
		});
	},

	/**
	 *
	 */
	showDebug() {
		const reportManager = container.get('ReportManager');
		reportManager.visualizeCurrentReport();

		if ((Memory.hivemind.showProcessDebug || 0) > 0) {
			Memory.hivemind.showProcessDebug--;
			hivemind.drawProcessDebug();
		}
	},

};

export const loop = ErrorMapper.wrapLoop(() => {
	main.loop();
});
