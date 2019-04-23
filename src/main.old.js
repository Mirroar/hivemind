'use strict';

/* global Creep */

/* eslint-disable import/no-unassigned-import */
require('./manager.military');
require('./manager.source');
/* eslint-enable import/no-unassigned-import */

const spawnManager = require('./manager.spawn');

// @todo Add a healer to defender squads, or spawn one when creeps are injured.

// @todo Do not send any remote harvesters or claimers until enemies in a room should have expired. Maybe scout from time to time.
// @todo make unarmed creeps run from hostiles.

// @todo Spawn creeps using "sequences" where more control is needed.

/**
 * Add additional data for each creep.
 */
Creep.prototype.enhanceData = function () {
	const role = this.memory.role;

	// Store creeps by role in global and room data.
	if (!Game.creepsByRole[role]) {
		Game.creepsByRole[role] = {};
	}

	Game.creepsByRole[role][this.name] = this;

	const room = this.room;
	if (!room.creeps) {
		room.creeps = {};
		room.creepsByRole = {};
	}

	room.creeps[this.name] = this;
	if (!room.creepsByRole[role]) {
		room.creepsByRole[role] = {};
	}

	room.creepsByRole[role][this.name] = this;

	// Store creeps that are part of a squad in their respectice squads.
	if (this.memory.squadName) {
		const squad = Game.squads[this.memory.squadName];
		if (squad) {
			if (!squad.units[this.memory.squadUnitType]) {
				squad.units[this.memory.squadUnitType] = [];
			}

			squad.units[this.memory.squadUnitType].push(this);
		}
	}

	// Store creeps that are part of an exploit operation in the correct object.
	if (this.memory.exploitName) {
		if (!Game.exploitTemp[this.memory.exploitName]) {
			Game.exploitTemp[this.memory.exploitName] = [];
		}

		Game.exploitTemp[this.memory.exploitName].push(this.id);
	}
};

const main = {

	/**
	 * Main game loop.
	 */
	loop() {
		const mainLoop = function () {
			spawnManager.manageSpawns();
		};

		mainLoop();
	},

};

module.exports = main;
