'use strict';

/* global RoomPosition RIGHT LEFT TOP BOTTOM */

/**
 * Base class for creep roles.
 * @constructor
 */
const Role = function () {
	this.throttleAt = 8000;
	this.stopAt = 2000;
};

Role.prototype.preRun = function (creep) {
	if (this.containSingleRoomCreep(creep)) return false;

	if (creep.room.boostManager && creep.room.boostManager.overrideCreepLogic(creep)) {
		return false;
	}
};

/**
 * Ensures that creeps which are restricted to a single room stay there.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 *
 * @return {boolean}
 *   True if creep is busy getting back to its room.
 */
Role.prototype.containSingleRoomCreep = function (creep) {
	if (!creep.memory.singleRoom) return false;

	if (creep.pos.roomName === creep.memory.singleRoom) {
		let stuck = true;
		if (creep.pos.x === 0) {
			creep.move(RIGHT);
		}
		else if (creep.pos.y === 0) {
			creep.move(BOTTOM);
		}
		else if (creep.pos.x === 49) {
			creep.move(LEFT);
		}
		else if (creep.pos.y === 49) {
			creep.move(TOP);
		}
		else {
			stuck = false;
		}

		if (stuck) {
			creep.say('unstuck!');
			delete creep.memory.go;
			creep.clearCachedPath();
			return true;
		}
	}
	else {
		creep.moveTo(new RoomPosition(25, 25, creep.memory.singleRoom));
		return true;
	}
};

module.exports = Role;
