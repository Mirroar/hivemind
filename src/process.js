'use strict';

var Process = function (params, data) {
  this.interval = null;
  if (params && params.interval) {
    this.interval = params.interval;
  }

  this.data = data;
};

/**
 * Determines whether this process should run this turn.
 */
Process.prototype.shouldRun = function () {
  if (this.interval) {
    // @todo Allow scaling of interval based on CPU.
    return Game.time - this.data.lastRun >= this.interval;
  }

  return true;
};

/**
 * Runs the given process.
 */
Process.prototype.run = function () {
  console.log('Trying to run a process `' + this.id + '` without implemented functionality.');
};

module.exports = Process;
