'use strict';

/* global FIND_MY_STRUCTURES CONTROLLER_STRUCTURES */

const Process = require('./process');

/**
 * Manages rooms we own.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const InactiveStructuresProcess = function (params, data) {
	Process.call(this, params, data);
	this.room = params.room;
};

InactiveStructuresProcess.prototype = Object.create(Process.prototype);

/**
 * Manages one of our rooms.
 */
InactiveStructuresProcess.prototype.run = function () {
	delete this.room.memory.inactiveStructures;

	// There are no inactive structures in fully upgraded rooms.
	const rcl = this.room.controller.level;
	if (rcl >= 8) return;

	this.room.memory.inactiveStructures = {};
	const groupedStructures = _.groupBy(this.room.find(FIND_MY_STRUCTURES), 'structureType');
	_.each(groupedStructures, (structures, structureType) => {
		// Check if more structures than allowed exist.
		if (!CONTROLLER_STRUCTURES[structureType] || structures.length <= CONTROLLER_STRUCTURES[structureType][rcl]) return;

		for (const structure of structures) {
			if (!structure.isActive()) {
				this.room.memory.inactiveStructures[structure.id] = 1;
			}
		}
	});
};

module.exports = InactiveStructuresProcess;
