'use strict';

var Logger = require('debug');

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

  this.loggers = {};
};

/**
 * Runs a given process.
 */
Hivemind.prototype.runProcess = function (id, processConstructor, options) {
  // @todo Add CPU usage histogram data for some processes.
  var stats = this.initializeProcessStats(id);

  let process = new processConstructor(options, this.memory.process[id]);

  if (process.shouldRun()) {
    this.memory.process[id].lastRun = Game.time;
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
 * Creates or gets an appropriate logger instance.
 */
Hivemind.prototype.log = function (channel, roomName) {
  let category = roomName || 'global';
  if (!this.loggers[category]) this.loggers[category] = {};
  if (!this.loggers[category][channel]) this.loggers[category][channel] = new Logger(channel, roomName);

  return this.loggers[category][channel];
};

module.exports = Hivemind;
