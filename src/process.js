'use strict';

var Process = function (params, data) {
  this.data = data;
};

/**
 * Determines whether this process should run this turn.
 */
Process.prototype.shouldRun = function () {
  return true;
};

/**
 * Runs the given process.
 */
Process.prototype.run = function () {
  console.log('Trying to run a process `' + this.id + '` without implemented functionality.');
};

module.exports = Process;
