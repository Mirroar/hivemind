/* global PWR_OPERATE_SPAWN POWER_INFO */

import container from 'utils/container';
import hivemind from 'hivemind';
import Process from 'process/process';
import RemoteMiningOperation from 'operation/remote-mining';
import settings from 'settings-manager';
import stats from 'utils/stats';
import {decodePosition} from 'utils/serialization';

declare global {
	interface StrategyMemory {
		remoteHarvesting?: {
			currentCount: number;
			lastCheck: number;
			sourceAssignments: Record<string, string>;
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
			Memory.strategy.remoteHarvesting = {
				currentCount: 30,
				lastCheck: Game.time,
				sourceAssignments: {},
			};
		}
	}

	/**
	 * Determines optimal number of remote mining rooms based on CPU and expansion
	 * plans.
	 */
	run() {
		const memory = Memory.strategy;

		// Migrate from old per-room format if needed.
		if ((memory.remoteHarvesting as any).rooms !== undefined) {
			delete (memory.remoteHarvesting as any).rooms;
			memory.remoteHarvesting.sourceAssignments = {};
		}

		const assignment = container.get('RemoteMinePrioritizer').getSourcesToMine(memory.remoteHarvesting.currentCount);
		memory.remoteHarvesting.sourceAssignments = assignment.sourceAssignments;

		this.adjustRemoteMiningCount(assignment.maxSources);
		this.manageOperations();
	}

	/**
	 * Periodically Adjusts remote harvesting room count.
	 *
	 * @param {number} availableHarvestRoomCount
	 *   Maximum number of harvest rooms that might be used.
	 */
	adjustRemoteMiningCount(availableSourceCount: number) {
		const memory = Memory.strategy;

		if (!memory.remoteHarvesting.lastCheck || !hivemind.hasIntervalPassed(1000, memory.remoteHarvesting.lastCheck)) return;

		memory.remoteHarvesting.lastCheck = Game.time;

		if (Game.myRooms.length === 1 && Game.cpu.limit >= 20) {
			// Early game, make sure to remote mine as much as possible for a quick start.
			memory.remoteHarvesting.currentCount = 30;
			return;
		}

		// Reduce count if we are over the available maximum.
		const availableWithBuffer = availableSourceCount + 5;
		if (memory.remoteHarvesting.currentCount > availableWithBuffer) {
			Game.notify('⚒ reduced remote mining count from ' + memory.remoteHarvesting.currentCount + ' to ' + availableWithBuffer + ' because that is the maximum number of available sources.');
			memory.remoteHarvesting.currentCount = availableWithBuffer;
		}

		// Check past CPU and bucket usage.
		const longTermBucket = stats.getStat('bucket', 10_000) || 10_000;
		const shortTermBucket = stats.getStat('bucket', 1000) || 10_000;
		const cpuUsage = stats.getStat('cpu_total', 1000) || 0.5;
		if (longTermBucket >= 9500 && shortTermBucket >= 9500 && cpuUsage <= 0.95 * Game.cpu.limit) {
			// We've been having bucket reserves and CPU cycles to spare.
			if (memory.remoteHarvesting.currentCount < availableSourceCount) {
				memory.remoteHarvesting.currentCount++;
			}
		}
		else if (shortTermBucket <= 8000 && memory.remoteHarvesting.currentCount > 0) {
			memory.remoteHarvesting.currentCount--;
		}
	}

	/**
	 * Creates or terminates remote mining operations based on selected rooms.
	 */
	manageOperations() {
		const memory = Memory.strategy;
		const sourceAssignments = memory.remoteHarvesting.sourceAssignments;

		// Derive unique remote rooms currently being mined.
		const activeRooms = [...new Set(
			Object.keys(sourceAssignments).map(k => decodePosition(k).roomName),
		)];

		// Create operations for selected rooms.
		for (const roomName of activeRooms) {
			if (!Game.operationsByType.mining['mine:' + roomName]) {
				const operation = new RemoteMiningOperation('mine:' + roomName);
				operation.setRoom(roomName);
			}
		}

		// Stop operations for rooms that are no longer selected.
		_.each(Game.operationsByType.mining, op => {
			if (!activeRooms.includes(op.getRoom())) {
				// Preserve operations that have active harvesters assigned to them.
				const hasActiveHarvesters = _.some(
					Game.creepsByRole['harvester.remote'] ?? {},
					c => c.memory.operation === op.name,
				);
				if (!hasActiveHarvesters) op.terminate();
			}
		});
	}
}
