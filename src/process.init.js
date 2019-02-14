'use strict';

const Process = require('./process');
const RoomPlanner = require('./room-planner');

/**
 * Initializes member variables that should be available to all processes.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const InitProcess = function (params, data) {
	Process.call(this, params, data);
};

InitProcess.prototype = Object.create(Process.prototype);

/**
 * @override
 */
InitProcess.prototype.run = function () {
	_.each(Game.rooms, room => {
		if (!room.controller || !room.controller.my) return;

		room.roomPlanner = new RoomPlanner(room.name);
	});
};

module.exports = InitProcess;
