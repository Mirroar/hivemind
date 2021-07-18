'use strict';

/* global RoomPosition FIND_FLAGS LOOK_STRUCTURES OBSTACLE_OBJECT_TYPES
STRUCTURE_RAMPART */

const Role = require('./role');
const utilities = require('./utilities');

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
		if (creep.operation && creep.operation.type === 'mining') {
			this.performOperationDismantle(creep);
			return;
		}

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

DismantlerRole.prototype.performOperationDismantle = function (creep) {
	if (!creep.memory.finishedPositions) creep.memory.finishedPositions = [];
	if (!creep.operation.needsDismantler(creep.memory.source)) {
		// @todo Return home and suicide.
		const targetPos = new RoomPosition(24, 24, creep.memory.sourceRoom);
		if (targetPos.roomName === creep.pos.roomName && creep.pos.getRangeTo(targetPos) <= 20) return;

		creep.moveToRange(targetPos, 20);
		return;
	}

	const targetPositions = creep.operation.getDismantlePositions(creep.memory.source);
	let target;
	for (const pos of targetPositions) {
		if (creep.memory.finishedPositions.indexOf(utilities.encodePosition(pos)) !== -1) continue;

		if (pos.roomName === creep.pos.roomName) {
			const structures = _.filter(
				pos.lookFor(LOOK_STRUCTURES),
				s => OBSTACLE_OBJECT_TYPES.indexOf(s.structureType) !== -1 || (s.structureType === STRUCTURE_RAMPART && !s.my)
			);

			if (structures.length === 0) {
				creep.memory.finishedPositions.push(utilities.encodePosition(pos));
				continue;
			}
		}

		target = pos;
		break;
	}

	if (!target) {
		// Just to be sure, start again from the top.
		delete creep.memory.finishedPositions;
		return;
	}

	if (creep.pos.roomName !== target.roomName || creep.pos.getRangeTo(target) > 1) {
		// Get into range of target tile.
		creep.moveToRange(target, 1);
		return;
	}

	const structures = _.filter(
		target.lookFor(LOOK_STRUCTURES),
		s => OBSTACLE_OBJECT_TYPES.indexOf(s.structureType) !== -1 || (s.structureType === STRUCTURE_RAMPART && !s.my)
	);

	creep.dismantle(structures[0]);
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

	if (!target && creep.room.roomManager && creep.room.roomManager.needsDismantling()) {
		target = creep.room.roomManager.getDismantleTarget();
		if (target) {
			target.notifyWhenAttacked(false);
		}
	}

	if (target) {
		if (creep.pos.getRangeTo(target) > 1) {
			creep.moveToRange(target, 1);
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
	if (!location) {
		creep.dropAny();
		return;
	}

	const pos = new RoomPosition(location.x, location.y, creep.pos.roomName);
	if (creep.pos.getRangeTo(pos) > 0) {
		creep.moveTo(pos);
	}
	else {
		creep.dropAny();
	}
};

module.exports = DismantlerRole;
