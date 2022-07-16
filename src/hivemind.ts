/* global RoomVisual PROCESS_PRIORITY_LOW PROCESS_PRIORITY_DEFAULT
PROCESS_PRIORITY_HIGH PROCESS_PRIORITY_ALWAYS */

import ProcessInterface from 'process/process-interface';
import Logger from 'utils/debug';
import Relations from 'relations';
import SegmentedMemory from 'utils/segmented-memory';
import settings, {SettingsManager} from 'settings-manager';
import stats from 'utils/stats';

const PROCESS_PRIORITY_LOW = 1;
const PROCESS_PRIORITY_DEFAULT = 2;
const PROCESS_PRIORITY_HIGH = 3;
const PROCESS_PRIORITY_ALWAYS = 10;

declare global {
	interface ProcessMemory {
		lastRun: number;
		lastCpu: number;
		parentId: string;
	}

	interface Memory {
		hivemind: KernelMemory;
	}

	interface KernelMemory {
		process: {},
		intelMigrated?: boolean;
		roomPlannerMigrated?: boolean;
		remoteMinersMigrated?: boolean;
		canExpand?: boolean;
		maxScoutDistance: number;
		showProcessDebug?: number;
	}
}

interface OutdatedRoomMemory {
	intel: any;
}

/* Default options for the various process priorities. */
const priorityEffects = {
	[PROCESS_PRIORITY_LOW]: {
		throttleAt: 9500,
		stopAt: 5000,
	},
	[PROCESS_PRIORITY_DEFAULT]: {
		throttleAt: 8000,
		stopAt: 3000,
	},
	[PROCESS_PRIORITY_HIGH]: {
		throttleAt: 5000,
		stopAt: 500,
	},
	[PROCESS_PRIORITY_ALWAYS]: {
		throttleAt: 0,
		stopAt: 0,
	},
};

/**
 * Kernel that can be used to run various processes.
 */
export default class Hivemind {
	memory: KernelMemory;
	relations: Relations;
	// @todo hivemind.settings should be removed. Any module needing access to
	// settings can import them directly.
	settings: SettingsManager;
	loggers: {}
	segmentMemory: SegmentedMemory;
	hasGlobalReset: boolean;
	currentProcess: ProcessInterface;
	emergencyBrakeProcessId: string;
	parentProcessId: string;
	cpuUsage: number;

	constructor() {
		if (!Memory.hivemind) {
			Memory.hivemind = {
				process: {},
				maxScoutDistance: 7,
			};
		}

		if (!Memory.rooms) {
			Memory.rooms = {};
		}

		this.memory = Memory.hivemind;
		this.relations = new Relations();
		this.settings = settings;
		this.loggers = {};

		// @todo Periodically clean old process memory.
	}

	setSegmentedMemory(memory: SegmentedMemory) {
		this.segmentMemory = memory;
	}

	/**
	 * Check CPU stats for throttling processes this turn.
	 */
	onTickStart() {
		this.cpuUsage = stats.getStat('cpu_total', 10) / Game.cpu.limit;
		this.parentProcessId = 'root';
		this.currentProcess = null;
		this.emergencyBrakeProcessId = null;

		// Refresh reference to memory object.
		this.memory = Memory.hivemind;

		this.gatherCpuStats();
	}

	/**
	 * Tells hivemind that a global reset has occured.
	 */
	logGlobalReset() {
		this.hasGlobalReset = true;
	}

	/**
	 * Gather CPU stats for periodic reports.
	 */
	gatherCpuStats() {
		if (!Memory.strategy) return;
		if (!Memory.strategy.reports) return;
		if (!Memory.strategy.reports.data) return;
		if (!Memory.strategy.reports.data.cpu) Memory.strategy.reports.data.cpu = {};

		const memory = Memory.strategy.reports.data.cpu;
		memory.totalTicks = (memory.totalTicks || 0) + 1;
		memory.bucket = (memory.bucket || 0) + Game.cpu.bucket;
		memory.cpu = (memory.cpu || 0) + (stats.getStat('cpu_total', 1) || 0);
		memory.cpuTotal = (memory.cpuTotal || 0) + Game.cpu.limit;

		if (this.hasGlobalReset) {
			memory.globalResets = (memory.globalResets || 0) + 1;
			this.hasGlobalReset = false;
		}
	}

	/**
	 * Runs a given process.
	 *
	 * @param {string} id
	 *   The id of the process in memory.
	 * @param {function} ProcessConstructor
	 *   Constructor function of the process to be run.
	 * @param {object} options
	 *   Options on how to run this process. These will also be passed to the
	 *   process itself.
	 *   The following keys are always available:
	 *   - interval: Set the minimum amount of ticks that should pass between runs
	 *     of this process. Use 0 for processes that run multiple times in a single
	 *     tick. (Default: 1)
	 *   - priotiry: Use one of the PROCESS_PRIORITY_* constants to determine how
	 *     this process should be throttled when cpu resources run low.
	 *     (Default: PROCESS_PRIORITY_DEFAULT)
	 *   - throttleAt: Override at what amount of free bucket this process should
	 *     start to run less often.
	 *   - stopAt: Override at what amount of free bucket this process should no
	 *     no longer run.
	 *   - requireSegments: If true, the process may only run after segment memory
	 *     has been fully loaded.
	 */
	runProcess<P extends ProcessParameters>(id: string, ProcessConstructor: {new (parameters: P): ProcessInterface}, options: P) {
		if (this.pullEmergengyBrake(id)) return;
		if (options && options.requireSegments && !this.segmentMemory.isReady()) return;

		// @todo Add CPU usage histogram data for some processes.
		const stats = this.initializeProcessStats(id);

		// @todo Think about reusing process objects between ticks.
		const process = new ProcessConstructor(options);

		if (this.isProcessAllowedToRun(stats, options) && process.shouldRun()) {
			const previousProcess = this.currentProcess;
			this.currentProcess = process;
			this.timeProcess(id, stats, () => process.run());
			this.currentProcess = previousProcess;
		}
	}

	/**
	 * Runs and times a function as part of the currently running process.
	 *
	 * @param {string} id
	 *   The id of the process in memory.
	 * @param {Function} callback
	 *   Function to run as the sub process. Will be called with the current
	 *   process as this-argument.
	 */
	runSubProcess(id, callback) {
		if (this.pullEmergengyBrake(id)) return;

		const stats = this.initializeProcessStats(id);
		this.timeProcess(id, stats, () => callback.call(this.currentProcess));
	}

	/**
	 * Decides whether current CPU usage is too high to run any more processes.
	 *
	 * @param {string} id
	 *   The id of the process in memory.
	 *
	 * @return {boolean}
	 *   True if running processes is forbidden.
	 */
	pullEmergengyBrake(id) {
		if (Game.cpu.getUsed() > Game.cpu.tickLimit * 0.85) {
			if (!this.emergencyBrakeProcessId) {
				this.emergencyBrakeProcessId = id;
				this.log('cpu').error('Shutting down all other processes before running', id, '-', Game.cpu.getUsed().toPrecision(3), '/', Game.cpu.tickLimit.toPrecision(3), 'cpu used!');
			}

			return true;
		}

		return false;
	}

	/**
	 * Runs a callback and records cpu usage in memory.
	 *
	 * @param {string} id
	 *   The id of the process in memory.
	 * @param {object} stats
	 *   Memory object to record cpu stats in.
	 * @param {Function} callback
	 *   Function to run while timing.
	 */
	timeProcess(id: string, stats, callback: () => void) {
		const previousRunTime = stats.lastRun;
		stats.lastRun = Game.time;
		const cpuBefore = Game.cpu.getUsed();
		stats.parentId = this.parentProcessId;
		this.parentProcessId = id;
		callback();
		this.parentProcessId = stats.parentId;
		const cpuUsage = Game.cpu.getUsed() - cpuBefore;

		this.memory.process[id].cpu = ((this.memory.process[id].cpu || cpuUsage) * 0.99) + (cpuUsage * 0.01);
		if (previousRunTime === Game.time) {
			this.memory.process[id].lastCpu += cpuUsage;
		}
		else {
			this.memory.process[id].lastCpu = cpuUsage;
		}
	}

	/**
	 * Makes sure some process stats are taken care of in persistent memory.
	 *
	 * @param {string} id
	 *   The id of the process in memory.
	 *
	 * @return {object}
	 *   Memory object allocated for this process' stats.
	 */
	initializeProcessStats(id) {
		if (!this.memory.process[id]) {
			this.memory.process[id] = {
				lastRun: 0,
			};
		}

		return this.memory.process[id];
	}

	/**
	 * Decides whether a process is allowed to run based on current CPU usage.
	 *
	 * @param {object} stats
	 *   Memory object allocated for this process' stats.
	 * @param {object} options
	 *   Options on how to run this process.
	 *   @see Hivemind.prototype.runProcess()
	 *
	 * @return {boolean}
	 *   Returns true if the process may run this tick.
	 */
	isProcessAllowedToRun(stats, options) {
		// Initialize process timing parameters.
		const interval = options.interval || 1;
		const priority = options.priority || PROCESS_PRIORITY_DEFAULT;
		const stopAt = options.stopAt || priorityEffects[priority].stopAt || 0;
		const throttleAt = options.throttleAt || priorityEffects[priority].throttleAt || 0;

		// Don't run process if bucket is too low.
		if (Game.cpu.bucket <= stopAt) return false;

		// No need to throttle if no interval is set.
		if (interval === 0 || priority === PROCESS_PRIORITY_ALWAYS) return true;

		// Run process if interval has elapsed.
		return this.hasIntervalPassed(interval, stats.lastRun, stopAt, throttleAt);
	}

	/**
	 * Checks if a given interval has passed, throttled by CPU usage.
	 *
	 * @param {number} interval
	 *   Minimum tick interval to wait.
	 * @param {number} startTime
	 *   Game tick on which the interval started.
	 * @param {number} stopAt
	 *   Minimum amount of bucket needed for this operation to run.
	 * @param {number} throttleAt
	 *   Amount of bucket at which this operation should always run.
	 *
	 * @return {boolean}
	 *   True if the interval has passed and we have sufficient cpu resources.
	 */
	hasIntervalPassed(interval: number, startTime: number, stopAt?: number, throttleAt?: number): boolean {
		// An interval of 0 always means caching for the current tick only.
		if (interval === 0) return Game.time !== startTime;

		// We check if the interval has actually been passed before adjusting
		// based on throttling to save Game.cpu.getUsed() calls.
		if (Game.time - startTime < interval) return false;
		if (Game.time - startTime < interval * this.getThrottleMultiplier(stopAt, throttleAt)) return false;

		return true;
	}

	/**
	 * Returns a multiplier for intervals based on current cpu usage.
	 *
	 * @param {number} stopAt
	 *   Minimum amount of bucket needed for this operation to run.
	 * @param {number} throttleAt
	 *   Amount of bucket at which this operation should always run.
	 *
	 * @return {number}
	 *   Multiplier of at least 1.
	 */
	getThrottleMultiplier(stopAt?: number, throttleAt?: number) {
		// Throttle process based on previous ticks' total cpu usage
		let throttling = Math.max(this.cpuUsage, 1);

		// Throttle process based on current cpu usage.
		const minThrottle = Game.cpu.limit / 2;
		const maxThrottle = Game.cpu.tickLimit;
		if (Game.cpu.getUsed() > minThrottle) {
			throttling /= 1 - ((Game.cpu.getUsed() - minThrottle) / (maxThrottle - minThrottle));
		}

		// Throttle process based on remaining bucket.
		if (!stopAt) stopAt = 0;
		if (!throttleAt) throttleAt = 5000;
		if (Game.cpu.bucket <= stopAt) return 99_999;
		if (Game.cpu.bucket < throttleAt) {
			throttling *= (throttleAt - stopAt) / (Game.cpu.bucket - stopAt);
		}

		return throttling;
	}

	/**
	 * Creates or reuses an appropriate logger instance.
	 *
	 * @param {string} channel
	 *   The name of the channel to get a logger for.
	 * @param {string|null} roomName
	 *   The name of the room to log this message for, or null if logging globally.
	 *
	 * @return {Logger}
	 *   The requested logger instance.
	 */
	log(channel: string, roomName?: string): Logger {
		const category = roomName || 'global';
		if (!this.loggers[category]) this.loggers[category] = {};
		if (!this.loggers[category][channel]) this.loggers[category][channel] = new Logger(channel, roomName);

		return this.loggers[category][channel];
	}

	/**
	 * Migrates data from an older hivemind version to this one.
	 *
	 * @return {boolean}
	 *   True if a migration is in progress, to prevent execution of other code.
	 */
	migrateData() {
		// Move room intel into segment memory.
		if (!this.memory.intelMigrated) {
			if (!this.segmentMemory.isReady()) return true;

			_.each(Memory.rooms, (memory: OutdatedRoomMemory, roomName: string) => {
				if (!memory.intel) return;

				const key = 'intel:' + roomName;
				this.segmentMemory.set(key, memory.intel);
				delete memory.intel;
			});

			this.segmentMemory.forceSave();
			this.memory.intelMigrated = true;
		}

		if (!this.memory.roomPlannerMigrated) {
			if (!this.segmentMemory.isReady()) return true;

			_.each(Memory.rooms, (memory, roomName) => {
				if (!memory.roomPlanner) return;

				const key = 'planner:' + roomName;
				this.segmentMemory.set(key, memory.roomPlanner);
				delete memory.roomPlanner;
			});

			this.segmentMemory.forceSave();
			this.memory.roomPlannerMigrated = true;
		}

		return false;
	}

	/**
	 * Shows a list of processes run in a tick, sorted by CPU usage.
	 */
	drawProcessDebug() {
		const processes = _.map(this.memory.process, (data: ProcessMemory, id: string) => ({
			id,
			lastRun: data.lastRun,
			lastCpu: data.lastCpu,
			parentId: data.parentId,
		}));
		const filtered = _.filter(processes, data => data.lastCpu > 0.5);
		const processData = _.groupBy(_.sortByOrder(filtered, ['lastRun', 'lastCpu'], ['desc', 'desc']), 'parentId');

		const visual = new RoomVisual();
		let lineNumber = 0;

		const drawProcesses = function (parentId, indent) {
			_.each(processData[parentId], data => {
				visual.text(String(_.round(data.lastCpu, 2)), 5, lineNumber, {align: 'right'});
				visual.text(data.id, 6 + indent, lineNumber, {align: 'left'});

				if (data.lastRun !== Game.time) {
					visual.text((Game.time - data.lastRun) + ' ago', 2, lineNumber, {align: 'right', color: '#808080'});
				}

				lineNumber++;

				drawProcesses(data.id, indent + 1);
			});
		};

		drawProcesses('root', 0);
	}
}

// const hivemind = new Hivemind();

export {
	PROCESS_PRIORITY_LOW,
	PROCESS_PRIORITY_DEFAULT,
	PROCESS_PRIORITY_HIGH,
	PROCESS_PRIORITY_ALWAYS,
};
// export default hivemind;
