'use strict';

/* global hivemind Creep RoomPosition TOP RIGHT BOTTOM LEFT */

/* eslint-disable import/no-unassigned-import */
require('./manager.military');
require('./manager.source');
require('./role.brawler');
require('./role.builder');
require('./role.builder.exploit');
require('./role.gift');
require('./role.harvester');
require('./role.harvester.exploit');
require('./role.harvester.remote');
require('./role.hauler');
require('./role.hauler.exploit');
require('./role.hauler.power');
require('./role.helper');
require('./role.transporter');
/* eslint-enable import/no-unassigned-import */
const roleRemoteBuilder = require('./role.builder.remote');

const spawnManager = require('./manager.spawn');
const utilities = require('./utilities');

// @todo Add a healer to defender squads, or spawn one when creeps are injured.

// @todo Do not send any remote harvesters or claimers until enemies in a room should have expired. Maybe scout from time to time.
// @todo make unarmed creeps run from hostiles.

// @todo Cache building info and CostMatrix objects when scanning rooms in intel manager.

// @todo Spawn creeps using "sequences" where more control is needed.

// Information about how throttling works for each creep role.
const creepThrottleLevels = {
	// Military creeps are always fully active!
	brawler: {
		max: 0,
		min: -1,
	},
	'builder.remote': {
		max: 0,
		min: -1,
	},

	// Some essential creeps only start throttling when things get critical.
	harvester: {
		max: 'critical',
		min: 0,
	},
	'harvester.minerals': {
		max: 'warning',
		min: 0,
	},
	'harvester.remote': {
		max: 'warning',
		min: 'critical',
	},
	'harvester.exploit': {
		max: 'normal',
		min: 0,
	},
	transporter: {
		max: 'normal',
		min: 0,
	},
};

const creepLogicFunctions = {
	harvester: 'runHarvesterLogic',
	'harvester.minerals': 'runHarvesterLogic',
	repairer: 'runBuilderLogic',
	builder: 'runBuilderLogic',
	transporter: 'runTransporterLogic',
	gift: 'performGiftCollection',
	'harvester.remote': 'runRemoteHarvesterLogic',
	'harvester.exploit': 'runExploitHarvesterLogic',
	hauler: 'runHaulerLogic',
	'hauler.exploit': 'runExploitHaulerLogic',
	'hauler.power': 'runPowerHaulerLogic',
	brawler: 'runBrawlerLogic',
	'builder.exploit': 'runExploitBuilderLogic',
	helper: 'runHelperLogic',
};

/**
 * Runs a creeps logic depending on role and other factors.
 */
Creep.prototype.runLogic = function () {
	const creep = this;

	if (!Game.creepPerformance[this.memory.role]) {
		Game.creepPerformance[this.memory.role] = {
			throttled: 0,
			count: 0,
			cpu: 0,
		};
	}

	if (!this.memory.throttleOffset) this.memory.throttleOffset = utilities.getThrottleOffset();
	let minBucket = null;
	let maxBucket = null;
	if (creepThrottleLevels[this.memory.role]) {
		const min = creepThrottleLevels[this.memory.role].min;
		const max = creepThrottleLevels[this.memory.role].max;

		if (min && Memory.throttleInfo.bucket[min]) {
			minBucket = Memory.throttleInfo.bucket[min];
		}
		else {
			minBucket = min;
		}

		if (max && Memory.throttleInfo.bucket[max]) {
			maxBucket = Memory.throttleInfo.bucket[max];
		}
		else {
			maxBucket = max;
		}
	}

	if (utilities.throttle(this.memory.throttleOffset, minBucket, maxBucket)) {
		if (creep.pos.x === 0 || creep.pos.x === 49 || creep.pos.y === 0 || creep.pos.y === 49) {
			// Do not throttle creeps at room borders, so they don't get stuck between rooms.
		}
		else {
			Game.numThrottledCreeps++;
			Game.creepPerformance[this.memory.role].throttled++;
			return;
		}
	}

	if (this.containSingleRoomCreep()) return;

	Game.creepPerformance[this.memory.role].count++;
	const startTime = Game.cpu.getUsed();

	this.runLogicByRole();

	if (!Game.creepPerformance[this.memory.role]) {
		Game.creepPerformance[this.memory.role] = {
			throttled: 0,
			count: 0,
			cpu: 0,
		};
	}

	Game.creepPerformance[this.memory.role].cpu += Game.cpu.getUsed() - startTime;
};

/**
 * Ensures that creeps which are restricted to a single room stay there.
 *
 * @return {boolean}
 *   True if creep is busy getting back to its room.
 */
Creep.prototype.containSingleRoomCreep = function () {
	if (this.memory.singleRoom && this.pos.roomName !== this.memory.singleRoom) {
		this.moveTo(new RoomPosition(25, 25, this.memory.singleRoom));
		return true;
	}

	if (this.memory.singleRoom && this.pos.roomName === this.memory.singleRoom) {
		let stuck = true;
		if (this.pos.x === 0) {
			this.move(RIGHT);
		}
		else if (this.pos.y === 0) {
			this.move(BOTTOM);
		}
		else if (this.pos.x === 49) {
			this.move(LEFT);
		}
		else if (this.pos.y === 49) {
			this.move(TOP);
		}
		else {
			stuck = false;
		}

		if (stuck) {
			this.say('unstuck!');
			delete this.memory.go;
			this.clearCachedPath();
			return true;
		}
	}
};

/**
 * Runs a creep's logic code depending on role.
 */
Creep.prototype.runLogicByRole = function () {
	const creep = this;

	try {
		if (creep.room.boostManager && creep.room.boostManager.overrideCreepLogic(creep)) {
			return;
		}

		if (creepLogicFunctions[creep.memory.role]) {
			creep[creepLogicFunctions[creep.memory.role]]();
		}
		else if (creep.memory.role === 'builder.remote') {
			roleRemoteBuilder.run(creep);
		}
	}
	catch (error) {
		console.log('Error when managing creep', creep.name, ':', error);
		console.log(error.stack);
	}
};

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
	 * Manages logic for all creeps.
	 */
	manageCreeps() {
		Game.numThrottledCreeps = 0;
		Game.creepPerformance = {};
		_.each(Game.creeps, creep => {
			if (!creep.spawning) creep.runLogic();
		});

		if (Game.numThrottledCreeps > 0) {
			hivemind.log('creeps').debug(Game.numThrottledCreeps, 'of', _.size(Game.creeps), 'creeps have been throttled due to bucket this tick.');
		}

		for (const role in Game.creepPerformance) {
			if (Game.creepPerformance[role].count > 0) {
				Game.creepPerformance[role].avg = Game.creepPerformance[role].cpu / Game.creepPerformance[role].count;
			}
		}
	},

	/**
	 * Main game loop.
	 */
	loop() {
		const mainLoop = function () {
			spawnManager.manageSpawns();

			main.manageCreeps();
		};

		mainLoop();
	},

};

module.exports = main;
