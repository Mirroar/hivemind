'use strict';

/**
 * Processes are run and managed by the hivemind kernel.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const Process = function (params, data) {
	this.data = data;
};

/**
 * Determines whether this process should run this tick.
 *
 * @return {boolean}
 *   Whether this process is allowed to run.
 */
Process.prototype.shouldRun = function () {
	return true;
};

/**
 * Runs the given process.
 */
Process.prototype.run = function () {
	console.error('Trying to run a process `' + this.id + '` without implemented functionality.');
};

module.exports = Process;
