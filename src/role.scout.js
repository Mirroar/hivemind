'use strict';

/* global RoomPosition */

const Role = require('./role');

const ScoutRole = function () {
	Role.call(this);
};

ScoutRole.prototype = Object.create(Role.prototype);

/**
 * Makes this creep move between rooms to gather intel.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
ScoutRole.prototype.performScout = function (creep) {
	if (!creep.memory.scoutTarget) {
		// Just stand around somewhere.
		const target = new RoomPosition(25, 25, creep.pos.roomName);
		if (creep.pos.getRangeTo(target) > 3) {
			creep.moveToRange(target, 3);
		}

		return;
	}

	if (typeof creep.room.visual !== 'undefined') {
		creep.room.visual.text(creep.memory.scoutTarget, creep.pos);
	}

	if (!creep.moveToRoom(creep.memory.scoutTarget, true)) {
		this.chooseScoutTarget(creep);
	}
};

/**
 * Chooses which of the possible scout target rooms to travel to.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
ScoutRole.prototype.chooseScoutTarget = function (creep) {
	creep.memory.scoutTarget = null;
	if (!Memory.strategy) return;

	const memory = Memory.strategy;

	let best = null;
	for (const info of _.values(memory.roomList)) {
		if (info.roomName === creep.pos.roomName) continue;

		if (info.origin === creep.memory.origin && info.scoutPriority > 0) {
			if (!best || best.scoutPriority < info.scoutPriority) {
				// Check distance / path to room.
				const path = creep.calculateRoomPath(info.roomName, true);

				if (path) {
					best = info;
				}
			}
		}
	}

	if (best) {
		creep.memory.scoutTarget = best.roomName;
	}

	if (!creep.memory.scoutTarget) {
		creep.memory.scoutTarget = creep.memory.origin;
	}
};

/**
 * Makes a creep behave like a scout.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
ScoutRole.prototype.run = function (creep) {
	if (!creep.memory.scoutTarget) {
		this.chooseScoutTarget(creep);
	}

	this.performScout(creep);
};

module.exports = ScoutRole;
