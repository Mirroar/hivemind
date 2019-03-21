'use strict';

/* global RoomVisual PROCESS_PRIORITY_LOW PROCESS_PRIORITY_DEFAULT
PROCESS_PRIORITY_HIGH PROCESS_PRIORITY_ALWAYS */

const Logger = require('./debug');
const Relations = require('./relations');
const RoomIntel = require('./room-intel');
const stats = require('./stats');

global.PROCESS_PRIORITY_LOW = 1;
global.PROCESS_PRIORITY_DEFAULT = 2;
global.PROCESS_PRIORITY_HIGH = 3;
global.PROCESS_PRIORITY_ALWAYS = 10;

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
 * @constructor
 */
const Hivemind = function () {
	if (!Memory.hivemind) {
		Memory.hivemind = {
			process: {},
		};
	}

	this.memory = Memory.hivemind;
	this.relations = new Relations();
	this.loggers = {};
	this.intel = {};

	// @todo Periodically clean old process memory.
};

/**
 * Check CPU stats for throttling processes this turn.
 */
Hivemind.prototype.onTickStart = function () {
	this.bucket = Game.cpu.bucket;
	this.cpuUsage = stats.getStat('cpu_total', 10) / Game.cpu.limit;
	this.parentProcessId = 'root';
	this.currentProcess = null;

	// Clear possibly outdated intel objects from last tick.
	this.intel = {};

	// Refresh reference to memory object.
	this.memory = Memory.hivemind;
};

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
 */
Hivemind.prototype.runProcess = function (id, ProcessConstructor, options) {
	// @todo Add CPU usage histogram data for some processes.
	const stats = this.initializeProcessStats(id);

	// @todo Think about reusing process objects between ticks.
	const process = new ProcessConstructor(options, this.memory.process[id]);

	if (this.isProcessAllowedToRun(stats, options) && process.shouldRun()) {
		const previousProcess = this.currentProcess;
		this.currentProcess = process;
		this.timeProcess(id, stats, () => process.run());
		this.currentProcess = previousProcess;
	}
};

/**
 * Runs and times a function as part of the currently running process.
 *
 * @param {string} id
 *   The id of the process in memory.
 * @param {Function} callback
 *   Function to run as the sub process. Will be called with the current
 *   process as this-argument.
 */
Hivemind.prototype.runSubProcess = function (id, callback) {
	const stats = this.initializeProcessStats(id);
	this.timeProcess(id, stats, () => callback.call(this.currentProcess));
};

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
Hivemind.prototype.timeProcess = function (id, stats, callback) {
	const prevRunTime = stats.lastRun;
	stats.lastRun = Game.time;
	const cpuBefore = Game.cpu.getUsed();
	stats.parentId = this.parentProcessId;
	this.parentProcessId = id;
	callback();
	this.parentProcessId = stats.parentId;
	const cpuUsage = Game.cpu.getUsed() - cpuBefore;

	this.memory.process[id].cpu = ((this.memory.process[id].cpu || cpuUsage) * 0.99) + (cpuUsage * 0.01);
	if (prevRunTime === Game.time) {
		this.memory.process[id].lastCpu += cpuUsage;
	}
	else {
		this.memory.process[id].lastCpu = cpuUsage;
	}
};

/**
 * Makes sure some process stats are taken care of in persistent memory.
 *
 * @param {string} id
 *   The id of the process in memory.
 *
 * @return {object}
 *   Memory object allocated for this process' stats.
 */
Hivemind.prototype.initializeProcessStats = function (id) {
	if (!this.memory.process[id]) {
		this.memory.process[id] = {
			lastRun: 0,
		};
	}

	return this.memory.process[id];
};

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
Hivemind.prototype.isProcessAllowedToRun = function (stats, options) {
	// Initialize process timing parameters.
	let interval = options.interval || 1;
	const priority = options.priority || PROCESS_PRIORITY_DEFAULT;
	const stopAt = options.stopAt || priorityEffects[priority].stopAt || 0;
	const throttleAt = options.throttleAt || priorityEffects[priority].throttleAt || 0;

	// Don't run process if bucket is too low.
	if (this.bucket <= this.stopAt) return false;

	// No need to throttle if no interval is set.
	if (interval === 0 || priority === PROCESS_PRIORITY_ALWAYS) return true;

	interval *= this.getThrottleMultiplier(stopAt, throttleAt);

	// Run process if interval has elapsed.
	return Game.time - stats.lastRun > interval;
};

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
Hivemind.prototype.getThrottleMultiplier = function (stopAt, throttleAt) {
	// Throttle process based on previous ticks' total cpu usage
	let throttling = Math.max(this.cpuUsage, 1);

	// Throttle process based on current cpu usage.
	const minThrottle = Game.cpu.limit / 2;
	const maxThrottle = Game.cpu.tickLimit;
	if (Game.cpu.getUsed() > minThrottle) {
		throttling /= 1 - ((Game.cpu.getUsed() - minThrottle) / (maxThrottle - minThrottle));
	}

	// Throttle process based on remaining bucket.
	if (this.bucket < throttleAt) {
		throttling *= (throttleAt - stopAt) / (this.bucket - stopAt);
	}

	return throttling;
};

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
Hivemind.prototype.log = function (channel, roomName) {
	const category = roomName || 'global';
	if (!this.loggers[category]) this.loggers[category] = {};
	if (!this.loggers[category][channel]) this.loggers[category][channel] = new Logger(channel, roomName);

	return this.loggers[category][channel];
};

/**
 * Factory method for room intel objects.
 *
 * @param {string} roomName
 *   The room for which to get intel.
 *
 * @return {RoomIntel}
 *   The requested RoomIntel object.
 */
Hivemind.prototype.roomIntel = function (roomName) {
	if (!this.intel[roomName]) {
		this.intel[roomName] = new RoomIntel(roomName);
	}

	return this.intel[roomName];
};

/**
 * Shows a list of processes run in a tick, sorted by CPU usage.
 */
Hivemind.prototype.drawProcessDebug = function () {
	const processes = _.map(this.memory.process, (data, id) => {
		return {
			id,
			lastRun: data.lastRun,
			lastCpu: data.lastCpu,
			parentId: data.parentId,
		};
	});
	const filtered = _.filter(processes, data => data.lastCpu > 0.5);
	const processData = _.groupBy(_.sortByOrder(filtered, ['lastRun', 'lastCpu'], ['desc', 'desc']), 'parentId');

	const visual = new RoomVisual();
	let lineNum = 0;

	const drawProcesses = function (parentId, indent) {
		_.each(processData[parentId], data => {
			visual.text(_.round(data.lastCpu, 2), 5, lineNum, {align: 'right'});
			visual.text(data.id, 6 + indent, lineNum, {align: 'left'});

			if (data.lastRun !== Game.time) {
				visual.text((Game.time - data.lastRun) + ' ago', 2, lineNum, {align: 'right', color: '#808080'});
			}

			lineNum++;

			drawProcesses(data.id, indent + 1);
		});
	};

	drawProcesses('root', 0);
};

module.exports = Hivemind;
