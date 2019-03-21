'use strict';

/* global hivemind PROCESS_PRIORITY_LOW PROCESS_PRIORITY_ALWAYS
POWER_SPAWN_ENERGY_RATIO */

const Process = require('./process');

const ManageLabsProcess = require('./process.rooms.owned.labs');
const ManageLinksProcess = require('./process.rooms.owned.links');
const RoomDefenseProcess = require('./process.rooms.owned.defense');
const RoomSongsProcess = require('./process.rooms.owned.songs');

/**
 * Manages rooms we own.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const OwnedRoomProcess = function (params, data) {
	Process.call(this, params, data);
	this.room = params.room;
};

OwnedRoomProcess.prototype = Object.create(Process.prototype);

/**
 * Manages on of our rooms.
 */
OwnedRoomProcess.prototype.run = function () {
	hivemind.runSubProcess('rooms_roomplanner', () => {
		this.room.roomPlanner.runLogic();
	});

	// @todo Only run processes based on current room level or existing structures.
	hivemind.runSubProcess('rooms_defense', () => {
		hivemind.runProcess(this.room.name + '_defense', RoomDefenseProcess, {
			room: this.room,
			priority: PROCESS_PRIORITY_ALWAYS,
		});
	});

	hivemind.runSubProcess('rooms_links', () => {
		hivemind.runProcess(this.room.name + '_links', ManageLinksProcess, {
			interval: 10,
			room: this.room,
		});
	});

	hivemind.runSubProcess('rooms_labs', () => {
		hivemind.runProcess(this.room.name + '_labs', ManageLabsProcess, {
			room: this.room,
		});
	});

	hivemind.runSubProcess('rooms_power', () => {
		// Process power in power spawns.
		const powerSpawn = this.room.powerSpawn;
		if (powerSpawn && powerSpawn.my && powerSpawn.power > 0 && powerSpawn.energy >= POWER_SPAWN_ENERGY_RATIO) {
			powerSpawn.processPower();
		}
	});

	hivemind.runSubProcess('rooms_observers', () => {
		// Use observers if requested.
		if (this.room.observer && this.room.memory.observeTargets && this.room.memory.observeTargets.length > 0) {
			const target = this.room.memory.observeTargets.pop();
			this.room.observer.observeRoom(target);
			this.room.observer.hasScouted = true;
		}
	});

	hivemind.runSubProcess('rooms_songs', () => {
		// Sing a song.
		hivemind.runProcess(this.room.name + '_song', RoomSongsProcess, {
			room: this.room,
			priority: PROCESS_PRIORITY_LOW,
		});
	});
};

module.exports = OwnedRoomProcess;
