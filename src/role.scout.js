'use strict';

/* global Creep RoomPosition */

/**
 * Makes this creep move between rooms to gather intel.
 */
Creep.prototype.performScout = function () {
	if (!this.memory.scoutTarget) {
		// Just stand around somewhere.
		const target = new RoomPosition(25, 25, this.pos.roomName);
		if (this.pos.getRangeTo(target) > 3) {
			this.moveToRange(target, 3);
		}

		return true;
	}

	if (typeof this.room.visual !== 'undefined') {
		this.room.visual.text(this.memory.scoutTarget, this.pos);
	}

	if (!this.moveToRoom(this.memory.scoutTarget)) {
		this.chooseScoutTarget();
		return false;
	}

	return true;
};

/**
 * Chooses which of the possible scout target rooms to travel to.
 */
Creep.prototype.chooseScoutTarget = function () {
	this.memory.scoutTarget = null;
	if (!Memory.strategy) {
		return false;
	}

	const memory = Memory.strategy;

	let best = null;
	for (const roomName in memory.roomList) {
		const info = memory.roomList[roomName];
		if (roomName === this.pos.roomName) continue;

		if (info.origin === this.memory.origin && info.scoutPriority > 0) {
			if (!best || best.scoutPriority < info.scoutPriority) {
				// Check distance / path to room.
				const path = this.calculateRoomPath(roomName);

				if (path) {
					best = info;
				}
			}
		}
	}

	if (best) {
		this.memory.scoutTarget = best.roomName;
	}

	if (!this.memory.scoutTarget) {
		this.memory.scoutTarget = this.memory.origin;
	}
};

/**
 * Makes a creep behave like a scout.
 */
Creep.prototype.runScoutLogic = function () {
	if (!this.memory.scoutTarget) {
		this.chooseScoutTarget();
	}

	this.performScout();
};
