'use strict';

var Process = require('process');

var RoomIntelProcess = function (params, data) {
	Process.call(this, params, data);
	this.room = params.room;
};
RoomIntelProcess.prototype = Object.create(Process.prototype);

RoomIntelProcess.prototype.run = function () {
	hivemind.roomIntel(this.room.name).gatherIntel();
	this.room.scan();

	this.findHostiles();
};

RoomIntelProcess.prototype.findHostiles = function () {
	let hostiles = this.room.find(FIND_HOSTILE_CREEPS);
	let parts = {};
	let lastSeen = this.room.memory.enemies && this.room.memory.enemies.lastSeen || 0;
	let safe = true;

	if (hostiles.length > 0) {
		this.room.assertMilitarySituation();
	}

	if (hostiles.length > 0) {
		// Count body parts for strength estimation.
		for (let j in hostiles) {
			if (hostiles[j].isDangerous()) {
				safe = false;
				lastSeen = Game.time;
			}
			for (let k in hostiles[j].body) {
				let type = hostiles[j].body[k].type;
				if (!parts[type]) {
					parts[type] = 0;
				}
				parts[type]++;
			}
		}
	}

	this.room.memory.enemies = {
		parts: parts,
		lastSeen: lastSeen,
		safe: safe,
	};
}

module.exports = RoomIntelProcess;
