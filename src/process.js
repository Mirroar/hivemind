'use strict';

/**
 * Processes are run and managed by the hivemind kernel.
 * @constructor
 *
 * @param {object} params
 * @param {object} data
 */
const Process = function (params, data) {
	this.data = data;
};

/**
 * Determines whether this process should run this turn.
 *
 * @return {boolean}
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
