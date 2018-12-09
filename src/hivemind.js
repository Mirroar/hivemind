'use strict';

var Logger = require('debug');
var Relations = require('relations');
var stats = require('stats');

global.PROCESS_PRIORITY_LOW = 1;
global.PROCESS_PRIORITY_DEFAULT = 2;
global.PROCESS_PRIORITY_HIGH = 3;
global.PROCESS_PRIORITY_ALWAYS = 10;

const priorityEffects = {
  1: {
    throttleAt: 9500,
    stopAt: 5000,
  },
  2: {
    throttleAt: 8000,
    stopAt: 3000,
  },
  3: {
    throttleAt: 5000,
    stopAt: 500,
  },
  10: {
    throttleAt: 0,
    stopAt: 0,
  },
};

/**
 * Kernel that can be used to run various processes.
 */
var Hivemind = function () {
  if (!Memory.hivemind) {
    Memory.hivemind = {
      process: {},
    };
  }
  this.memory = Memory.hivemind;
  this.relations = new Relations();

  this.loggers = {};

  // @todo Periodically clean old process memory.
};

/**
 * Check CPU stats for throttling processes this turn.
 */
Hivemind.prototype.onTickStart = function () {
  this.bucket = Game.cpu.bucket;
  this.cpuUsage = stats.getStat('cpu_total', 10) / Game.cpu.limit;
};

/**
 * Runs a given process.
 */
Hivemind.prototype.runProcess = function (id, processConstructor, options) {
  // @todo Add CPU usage histogram data for some processes.
  var stats = this.initializeProcessStats(id);

  // @todo Think about reusing process objects between ticks.
  let process = new processConstructor(options, this.memory.process[id]);

  if (this.isProcessAllowedToRun(stats, options) && process.shouldRun()) {
    stats.lastRun = Game.time;
    process.run();
  }
};

/**
 * Makes sure some process stats are taken care of in persistent memory.
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
 */
Hivemind.prototype.isProcessAllowedToRun = function (stats, options) {
  // Initialize process timing parameters.
  let interval = options.interval || 1;
  let priority = options.priority || PROCESS_PRIORITY_DEFAULT;
  let stopAt = options.stopAt || priorityEffects[priority].stopAt || 0;
  let throttleAt = options.throttleAt || priorityEffects[priority].throttleAt || 0;

  // Don't run process if bucket is too low.
  if (this.bucket <= this.stopAt) return false;

  // No need to throttle if no interval is set.
  if (interval == 0 || priority == PROCESS_PRIORITY_ALWAYS) return true;

  // Throttle process based on current cpu usage.
  let throttling = Math.max(this.cpuUsage, 1);
  if (this.bucket < throttleAt) {
    throttling *= (throttleAt - stopAt) / (this.bucket - stopAt);
  }
  if (throttling > 1) {
    interval *= throttling;
  }

  // Run process if interval has elapsed.
  return Game.time - stats.lastRun > interval;
};

/**
 * Creates or gets an appropriate logger instance.
 */
Hivemind.prototype.log = function (channel, roomName) {
  let category = roomName || 'global';
  if (!this.loggers[category]) this.loggers[category] = {};
  if (!this.loggers[category][channel]) this.loggers[category][channel] = new Logger(channel, roomName);

  return this.loggers[category][channel];
};

module.exports = Hivemind;
