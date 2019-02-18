'use strict';

/* global Creep RoomPosition FIND_FLAGS LOOK_STRUCTURES */

/**
 * Makes the creep use energy to finish construction sites in the current room.
 */
Creep.prototype.performDismantle = function () {
	// First, get to target room.
	if (this.pos.roomName !== this.memory.targetRoom) {
		this.moveToRoom(this.memory.targetRoom);
		return;
	}

	let target;

	// Look for dismantle flags.
	const flags = this.room.find(FIND_FLAGS, {
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

	if (!target && this.room.roomPlanner && this.room.roomPlanner.needsDismantling()) {
		target = this.room.roomPlanner.getDismantleTarget();
		if (target) {
			target.notifyWhenAttacked(false);
		}
	}

	if (target) {
		if (this.pos.getRangeTo(target) > 1) {
			this.moveTo(target);
		}
		else {
			this.dismantle(target);
		}
	}
};

Creep.prototype.performDismantlerDeliver = function () {
	// First, get to delivery room.
	if (this.pos.roomName !== this.memory.sourceRoom) {
		this.moveTo(new RoomPosition(25, 25, this.memory.sourceRoom));
		return;
	}

	// Deliver to storage if possible.
	if (this.room.storage) {
		if (this.pos.getRangeTo(this.room.storage) > 1) {
			this.moveTo(this.room.storage);
		}
		else {
			this.transferAny(this.room.storage);
		}

		return;
	}

	const location = this.room.getStorageLocation();
	const pos = new RoomPosition(location.x, location.y, this.pos.roomName);
	if (this.pos.getRangeTo(pos) > 0) {
		this.moveTo(pos);
	}
	else {
		this.dropAny();
	}
};

/**
 * Puts this creep into or out of dismantling mode.
 *
 * @param {boolean} dismantling
 *   Whether this creep should be dismantling buildings.
 */
Creep.prototype.setDismantlerState = function (dismantling) {
	this.memory.dismantling = dismantling;
};

/**
 * Makes a creep behave like a dismantler.
 */
Creep.prototype.runDismantlerLogic = function () {
	if (!this.memory.sourceRoom) {
		this.memory.sourceRoom = this.pos.roomName;
	}

	if (!this.memory.targetRoom) {
		this.memory.targetRoom = this.pos.roomName;
	}

	if (this.memory.dismantling && this.carryCapacity > 0 && _.sum(this.carry) >= this.carryCapacity) {
		this.setDismantlerState(false);
	}
	else if (!this.memory.dismantling && _.sum(this.carry) === 0) {
		this.setDismantlerState(true);
	}

	if (this.memory.dismantling) {
		this.performDismantle();
		return;
	}

	this.performDismantlerDeliver();
};
