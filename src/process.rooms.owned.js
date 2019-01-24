'use strict';

var Process = require('process');

var ManageLabsProcess = require('process.rooms.owned.labs');
var ManageLinksProcess = require('process.rooms.owned.links');
var RoomDefenseProcess = require('process.rooms.owned.defense');
var RoomSongsProcess = require('process.rooms.owned.songs');

var OwnedRoomProcess = function (params, data) {
	Process.call(this, params, data);
	this.room = params.room;
};
OwnedRoomProcess.prototype = Object.create(Process.prototype);

OwnedRoomProcess.prototype.run = function () {
	this.room.roomPlanner.runLogic();

	// @todo Only run processes based on current room level or existing structures.
	hivemind.runProcess(this.room.name + '_defense', RoomDefenseProcess, {
		room: this.room,
		priority: PROCESS_PRIORITY_HIGH,
	});

	this.room.generateLinkNetwork();
	hivemind.runProcess(this.room.name + '_links', ManageLinksProcess, {
		interval: 10,
		room: this.room,
	});

	hivemind.runProcess(this.room.name + '_labs', ManageLabsProcess, {
		room: this.room,
	});

	// Process power in power spawns.
	let powerSpawn = this.room.powerSpawn;
	if (powerSpawn && powerSpawn.my && powerSpawn.power > 0 && powerSpawn.energy >= POWER_SPAWN_ENERGY_RATIO) {
		powerSpawn.processPower();
	}

	// Use observers if requested.
	if (this.room.observer && this.room.memory.observeTargets && this.room.memory.observeTargets.length > 0) {
		let target = this.room.memory.observeTargets.pop();
		this.room.observer.observeRoom(target);
		this.room.observer.hasScouted = true;
	}

	// Sing a song.
	hivemind.runProcess(this.room.name + '_song', RoomSongsProcess, {
		room: this.room,
		priority: PROCESS_PRIORITY_LOW,
	});
};

module.exports = OwnedRoomProcess;
