'use strict';

/* global RoomPosition FIND_FLAGS LOOK_STRUCTURES */

const Role = require('./role');

const DismantlerRole = function () {
	Role.call(this);
};

DismantlerRole.prototype = Object.create(Role.prototype);

/**
 * Makes a creep behave like a dismantler.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
DismantlerRole.prototype.run = function (creep) {
	if (!creep.memory.sourceRoom) {
		creep.memory.sourceRoom = creep.pos.roomName;
	}

	if (!creep.memory.targetRoom) {
		creep.memory.targetRoom = creep.pos.roomName;
	}

	if (creep.memory.dismantling && creep.carryCapacity > 0 && _.sum(creep.carry) >= creep.carryCapacity) {
		this.setDismantlerState(creep, false);
	}
	else if (!creep.memory.dismantling && _.sum(creep.carry) === 0) {
		this.setDismantlerState(creep, true);
	}

	if (creep.memory.dismantling) {
		this.performDismantle(creep);
		return;
	}

	this.performDismantlerDeliver(creep);
};

/**
 * Puts this creep into or out of dismantling mode.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 * @param {boolean} dismantling
 *   Whether this creep should be dismantling buildings.
 */
DismantlerRole.prototype.setDismantlerState = function (creep, dismantling) {
	creep.memory.dismantling = dismantling;
};

/**
 * Makes the creep use energy to finish construction sites in the current room.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
DismantlerRole.prototype.performDismantle = function (creep) {
	// First, get to target room.
	if (creep.pos.roomName !== creep.memory.targetRoom) {
		creep.moveToRoom(creep.memory.targetRoom);
		return;
	}

	let target;

	// Look for dismantle flags.
	const flags = creep.room.find(FIND_FLAGS, {
		filter: flag => flag.name.startsWith('Dismantle:'),
	});
	for (const flag of flags) {
		const structures = flag.pos.lookFor(LOOK_STRUCTURES);

		if (structures.length === 0) {
			// Done dismantling.
			flag.remove();
			continue;
		}

		target = structures[0];
		break;
	}

	if (!target && creep.room.roomPlanner && creep.room.roomPlanner.needsDismantling()) {
		target = creep.room.roomPlanner.getDismantleTarget();
		if (target) {
			target.notifyWhenAttacked(false);
		}
	}

	if (target) {
		if (creep.pos.getRangeTo(target) > 1) {
			creep.moveTo(target);
		}
		else {
			creep.dismantle(target);
		}
	}
};

/**
 * Makes the creep deliver its stored energy.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
DismantlerRole.prototype.performDismantlerDeliver = function (creep) {
	// First, get to delivery room.
	if (creep.pos.roomName !== creep.memory.sourceRoom) {
		creep.moveTo(new RoomPosition(25, 25, creep.memory.sourceRoom));
		return;
	}

	// Deliver to storage if possible.
	if (creep.room.storage) {
		if (creep.pos.getRangeTo(creep.room.storage) > 1) {
			creep.moveTo(creep.room.storage);
		}
		else {
			creep.transferAny(creep.room.storage);
		}

		return;
	}

	const location = creep.room.getStorageLocation();
	const pos = new RoomPosition(location.x, location.y, creep.pos.roomName);
	if (creep.pos.getRangeTo(pos) > 0) {
		creep.moveTo(pos);
	}
	else {
		creep.dropAny();
	}
};

module.exports = DismantlerRole;
