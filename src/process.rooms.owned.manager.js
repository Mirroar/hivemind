'use strict';

const Process = require('./process');

module.exports = class RoomManagerProcess extends Process {
	/**
	 * Manages structures in owned rooms.
	 * @constructor
	 *
	 * @param {object} params
	 *   Options on how to run this process.
	 * @param {object} data
	 *   Memory object allocated for this process' stats.
	 */
	constructor(params, data) {
		super(params, data);
		this.room = params.room;
	}

	/**
	 * Manages structures in a given room.
	 */
	run() {
		this.room.roomManager.runLogic();
	}
};
