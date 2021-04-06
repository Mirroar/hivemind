'use strict';

/* global OK */

const utilities = require('./utilities');
const Role = require('./role');

const ClaimerRole = function () {
	Role.call(this);

	// Claimers have high priority because of their short life spans.
	this.stopAt = 0;
	this.throttleAt = 0;
};

ClaimerRole.prototype = Object.create(Role.prototype);

/**
 * Makes a creep behave like a claimer.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
ClaimerRole.prototype.run = function (creep) {
	if (this.moveToTargetRoom(creep)) return;

	if (creep.memory.mission === 'reserve') {
		this.performReserve(creep);
	}
	else if (creep.memory.mission === 'claim') {
		this.performClaim(creep);
	}
};

/**
 * Moves the creep to the target room for its order.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 *
 * @return {boolean}
 *   True if the creep is still busy moving towards the target room.
 */
ClaimerRole.prototype.moveToTargetRoom = function (creep) {
	const targetPosition = utilities.decodePosition(creep.memory.target);
	if (!creep.hasCachedPath() && Memory.rooms[creep.room.name].remoteHarvesting && Memory.rooms[creep.room.name].remoteHarvesting[creep.memory.target]) {
		const harvestMemory = Memory.rooms[creep.room.name].remoteHarvesting[creep.memory.target];

		if (harvestMemory.cachedPath) {
			creep.setCachedPath(harvestMemory.cachedPath.path, false, 1);
		}
	}

	if (creep.hasCachedPath()) {
		if (creep.hasArrived() || creep.pos.getRangeTo(targetPosition) < 3) {
			creep.clearCachedPath();
		}
		else {
			creep.followCachedPath();
			return true;
		}
	}

	return false;
};

/**
 * Makes the creep claim a room for the hive!
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
ClaimerRole.prototype.performClaim = function (creep) {
	const targetPosition = utilities.decodePosition(creep.memory.target);

	if (targetPosition.roomName !== creep.pos.roomName) {
		creep.moveTo(targetPosition);
		return;
	}

	const target = creep.room.controller;

	if (target.owner && !target.my && creep.memory.body && creep.memory.body.claim >= 5) {
		if (creep.pos.getRangeTo(target) > 1) {
			creep.moveTo(target);
		}
		else {
			creep.claimController(target);
		}
	}
	else if (!target.my) {
		const numRooms = _.size(_.filter(Game.rooms, room => room.isMine()));
		const maxRooms = Game.gcl.level;

		if (creep.pos.getRangeTo(target) > 1) {
			creep.moveTo(target);
		}
		else if (numRooms < maxRooms) {
			creep.claimController(target);
		}
		else {
			creep.reserveController(target);
		}
	}
};

/**
 * Makes the creep reserve a room.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
ClaimerRole.prototype.performReserve = function (creep) {
	const targetPosition = utilities.decodePosition(creep.memory.target);
	if (targetPosition.roomName !== creep.pos.roomName) {
		creep.moveTo(targetPosition);
		return;
	}

	const target = creep.room.controller;

	if (creep.pos.getRangeTo(target) > 1) {
		creep.moveTo(target);
	}
	else {
		if (creep.room.controller.reservation && creep.room.controller.reservation.username !== utilities.getUsername()) {
			creep.attackController(target);
			return;
		}

		const result = creep.reserveController(target);
		if (result === OK) {
			let reservation = 0;
			if (creep.room.controller.reservation && creep.room.controller.reservation.username === utilities.getUsername()) {
				reservation = creep.room.controller.reservation.ticksToEnd;
			}

			creep.room.memory.lastClaim = {
				time: Game.time,
				value: reservation,
			};
		}

		if (target.sign && target.sign.username) {
			creep.signController(target, '');
		}
	}
};

module.exports = ClaimerRole;
