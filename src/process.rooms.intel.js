'use strict';

/* global hivemind FIND_HOSTILE_CREEPS */

const Process = require('./process');

const RoomIntelProcess = function (params, data) {
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
	const hostiles = this.room.find(FIND_HOSTILE_CREEPS);
	const parts = {};
	let lastSeen = this.room.memory.enemies && this.room.memory.enemies.lastSeen || 0;
	let safe = true;

	if (hostiles.length > 0) {
		// this.room.assertMilitarySituation();
	}

	if (hostiles.length > 0) {
		// Count body parts for strength estimation.
		for (const j in hostiles) {
			if (hostiles[j].isDangerous()) {
				safe = false;
				lastSeen = Game.time;
			}

			for (const k in hostiles[j].body) {
				const type = hostiles[j].body[k].type;
				if (!parts[type]) {
					parts[type] = 0;
				}

				parts[type]++;
			}
		}
	}

	this.room.memory.enemies = {
		parts,
		lastSeen,
		safe,
	};
};

module.exports = RoomIntelProcess;
