'use strict';

/* global hivemind RoomPosition RESOURCE_POWER FIND_STRUCTURES OK
STRUCTURE_POWER_BANK FIND_DROPPED_RESOURCES */

const Role = require('./role');

const PowerHaulerRole = function () {
	Role.call(this);
};

PowerHaulerRole.prototype = Object.create(Role.prototype);

/**
 * Makes a creep act like a power hauler.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
PowerHaulerRole.prototype.run = function (creep) {
	if (creep.memory.isReturning) {
		this.returnHome(creep);
		return;
	}

	const targetPosition = new RoomPosition(25, 25, creep.memory.targetRoom);
	const isInTargetRoom = creep.pos.roomName === targetPosition.roomName;
	if (!isInTargetRoom || (!creep.isInRoom() && creep.getNavMeshMoveTarget())) {
		if (creep.moveUsingNavMesh(targetPosition) !== OK) {
			hivemind.log('creeps').debug(creep.name, 'can\'t move from', creep.pos.roomName, 'to', targetPosition.roomName);
			// @todo This is cross-room movement and should therefore only calculate a path once.
			creep.moveToRange(targetPosition, 3);
		}

		return;
	}

	creep.stopNavMeshMove();

	const powerBanks = creep.room.find(FIND_STRUCTURES, {
		filter: structure => structure.structureType === STRUCTURE_POWER_BANK,
	});

	if (powerBanks.length > 0) {
		// Wait close by until power bank is destroyed.
		const powerBank = powerBanks[0];
		if (creep.pos.getRangeTo(powerBank) > 5) {
			creep.moveToRange(powerBank, 5);
		}

		return;
	}

	this.pickupPower(creep);
};

/**
 * Makes the hauler return to its source room.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
PowerHaulerRole.prototype.returnHome = function (creep) {
	const targetPosition = new RoomPosition(25, 25, creep.memory.sourceRoom);
	const isInTargetRoom = creep.pos.roomName === targetPosition.roomName;
	if (!isInTargetRoom || (!creep.isInRoom() && creep.getNavMeshMoveTarget())) {
		if (creep.moveUsingNavMesh(targetPosition) !== OK) {
			hivemind.log('creeps').debug(creep.name, 'can\'t move from', creep.pos.roomName, 'to', targetPosition.roomName);
			// @todo This is cross-room movement and should therefore only calculate a path once.
			creep.moveToRange(targetPosition, 3);
		}

		return;
	}

	creep.stopNavMeshMove();

	// Put power in storage.
	if ((creep.carry[RESOURCE_POWER] || 0) > 0) {
		const target = creep.room.getBestStorageTarget(creep.carry[RESOURCE_POWER], RESOURCE_POWER);

		if (target) {
			if (creep.pos.getRangeTo(target) > 1) {
				creep.moveToRange(target, 1);
				return;
			}

			creep.transferAny(target);
			return;
		}

		// Whelp, no delivery target. Let transporters handle it.
		creep.drop(RESOURCE_POWER);
	}
	else {
		delete creep.memory.isReturning;
	}
};

/**
 * Makes the hauler pick up power from the ground.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
PowerHaulerRole.prototype.pickupPower = function (creep) {
	const powerResources = creep.room.find(FIND_DROPPED_RESOURCES, {
		filter: resource => resource.resourceType === RESOURCE_POWER,
	});

	if (_.sum(creep.carry) >= creep.carryCapacity || powerResources.length === 0) {
		// Return home.
		creep.memory.isReturning = true;
		return;
	}

	if (powerResources.length <= 0) {
		// Return home.
		if (_.sum(creep.carry) > 0) {
			creep.memory.isReturning = true;
		}

		// Mark operation as finished.
		if (Memory.strategy && Memory.strategy.power && Memory.strategy.power.rooms && Memory.strategy.power.rooms[creep.memory.targetRoom]) {
			Memory.strategy.power.rooms[creep.memory.targetRoom].isActive = false;
			Memory.strategy.power.rooms[creep.memory.targetRoom].amount = 0;
		}

		return;
	}

	if (creep.pos.getRangeTo(powerResources[0]) > 1) {
		creep.moveToRange(powerResources[0], 1);
		return;
	}

	creep.pickup(powerResources[0]);
};

module.exports = PowerHaulerRole;
