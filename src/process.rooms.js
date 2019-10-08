'use strict';

/* global hivemind PROCESS_PRIORITY_ALWAYS */

const Process = require('./process');
const OwnedRoomProcess = require('./process.rooms.owned');
const RoomIntelProcess = require('./process.rooms.intel');
const RoomPlanner = require('./room-planner');

/**
 * Runs logic for all rooms we have visibility in.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const RoomsProcess = function (params, data) {
	Process.call(this, params, data);
};

RoomsProcess.prototype = Object.create(Process.prototype);

/**
 * Runs logic in all rooms.
 */
RoomsProcess.prototype.run = function () {
	_.each(Game.rooms, (room, roomName) => {
		hivemind.runProcess('rooms_intel', RoomIntelProcess, {
			room,
			priority: PROCESS_PRIORITY_ALWAYS,
		});

		// Manage owned rooms.
		// @todo Keep a list of managed rooms in memory so we can notice when
		// a room gets lost or a new one claimed.
		if (room.isMine()) {
			hivemind.runProcess('owned_rooms', OwnedRoomProcess, {
				room,
				priority: PROCESS_PRIORITY_ALWAYS,
			});
		}

		// Add roomPlanner to expansion target room.
		// @todo Maybe move to extra process, this is misplaced in this loop.
		if (Memory.strategy && Memory.strategy.expand && Memory.strategy.expand.currentTarget && Memory.strategy.expand.currentTarget.roomName === roomName) {
			room.roomPlanner = new RoomPlanner(roomName);
			room.roomPlanner.runLogic();
		}
	});
};

module.exports = RoomsProcess;
