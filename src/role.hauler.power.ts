'use strict';

/* global hivemind RoomPosition RESOURCE_POWER FIND_STRUCTURES OK ATTACK_POWER
STRUCTURE_POWER_BANK FIND_DROPPED_RESOURCES FIND_RUINS MAX_CREEP_SIZE
FIND_TOMBSTONES */

import Role from './role';

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
	if (!creep.memory.isReturning && (creep.store.getFreeCapacity() === 0 || (creep.store.power || 0) > creep.store.getCapacity() / 10)) {
		// Return home.
		creep.memory.isReturning = true;
		return;
	}

	if (creep.memory.isReturning) {
		this.returnHome(creep);
		return;
	}

	const targetPosition = new RoomPosition(25, 25, creep.memory.targetRoom);
	const isInTargetRoom = creep.pos.roomName === targetPosition.roomName;

	// Pick up dropped power in rooms we pass.
	if (!isInTargetRoom && this.pickupResources(creep, RESOURCE_POWER)) return;

	// Get to target room.
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
		const powerBank = powerBanks[0];
		// Get close to power bank if it's close to being destoryed.
		if (powerBank.hits < ATTACK_POWER * MAX_CREEP_SIZE * 5) {
			if (creep.pos.getRangeTo(powerBank) > 1) {
				creep.moveToRange(powerBank, 1);
			}

			// Also drop anything that's not power, it can be picked up again once
			// power is depleted.
			if (creep.store.getUsedCapacity() > (creep.store[RESOURCE_POWER] || 0)) {
				for (const resourceType of _.keys(creep.store)) {
					if (resourceType === RESOURCE_POWER) continue;
					if (!creep.store[resourceType]) continue;
					creep.drop(resourceType);
					break;
				}
			}

			return;
		}

		// Pick up things in the room while waiting.
		if (this.pickupResources(creep)) return;

		// Wait close by until power bank is destroyed.
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

	// Pick up dropped power in rooms we pass.
	if (!isInTargetRoom && creep.store.getFreeCapacity() > 0 && this.pickupResources(creep, RESOURCE_POWER)) return;

	if (!isInTargetRoom || (!creep.isInRoom() && creep.getNavMeshMoveTarget())) {
		if (creep.moveUsingNavMesh(targetPosition) !== OK) {
			hivemind.log('creeps').debug(creep.name, 'can\'t move from', creep.pos.roomName, 'to', targetPosition.roomName);
			// @todo This is cross-room movement and should therefore only calculate a path once.
			creep.moveToRange(targetPosition, 3);
		}

		return;
	}

	creep.stopNavMeshMove();

	// Put resources in storage.
	if (creep.store.getUsedCapacity() > 0) {
		for (const resourceType of _.keys(creep.store)) {
			if ((creep.store[resourceType] || 0) === 0) continue;

			const target = creep.room.getBestStorageTarget(creep.store[resourceType], resourceType);

			if (target) {
				if (creep.pos.getRangeTo(target) > 1) {
					creep.moveToRange(target, 1);
					return;
				}

				creep.transfer(target, resourceType);
				return;
			}

			// Whelp, no delivery target. Let transporters handle it.
			creep.drop(resourceType);
			return;
		}
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
	if (powerResources.length > 0) {
		if (creep.pos.getRangeTo(powerResources[0]) > 1) {
			creep.moveToRange(powerResources[0], 1);
			return;
		}

		creep.pickup(powerResources[0]);
		return;
	}

	const powerRuins = creep.room.find(FIND_RUINS, {
		filter: ruin => (ruin.store.power || 0) > 0,
	});
	if (powerRuins.length > 0) {
		if (creep.pos.getRangeTo(powerRuins[0]) > 1) {
			creep.moveToRange(powerRuins[0], 1);
			return;
		}

		creep.withdraw(powerRuins[0], RESOURCE_POWER);
		return;
	}

	// Mark operation as finished.
	if (Memory.strategy && Memory.strategy.power && Memory.strategy.power.rooms && Memory.strategy.power.rooms[creep.memory.targetRoom]) {
		Memory.strategy.power.rooms[creep.memory.targetRoom].isActive = false;
		Memory.strategy.power.rooms[creep.memory.targetRoom].amount = 0;
	}

	// Loot anything else nearby, like tombstones and dropped resources.
	if (this.pickupResources(creep)) return;

	// Return home.
	creep.memory.isReturning = true;
};

PowerHaulerRole.prototype.pickupResources = function (creep, resourceType) {
	let target;
	if (creep.memory.pickupTarget) {
		target = Game.getObjectById(creep.memory.pickupTarget);

		if (!target) {
			delete creep.memory.pickupTarget;
		}
		else if (target.store && (target.store.getUsedCapacity() === 0 || (resourceType && (target.store[resourceType] || 0) === 0))) {
			// Target doesn't contain the required resource anymore.
			delete creep.memory.pickupTarget;
			target = null;
		}
	}

	if (!target) {
		const resources = creep.room.find(FIND_DROPPED_RESOURCES, {
			filter: resource => resource.amount >= 10 && (!resourceType || resource.resourceType === resourceType),
		});
		const ruins = creep.room.find(FIND_RUINS, {
			filter: ruin => ruin.store.getUsedCapacity(resourceType) >= 10,
		});
		const tombs = creep.room.find(FIND_TOMBSTONES, {
			filter: tomb => tomb.store.getUsedCapacity(resourceType) >= 10,
		});

		for (const collection of [resources, ruins, tombs]) {
			if (collection.length === 0) continue;

			creep.memory.pickupTarget = collection[0].id;
			target = collection[0];
			break;
		}
	}

	if (!target) return false;

	if (creep.pos.getRangeTo(target.pos) > 1) {
		creep.moveToRange(target, 1);
		return true;
	}

	if (target.amount) {
		creep.pickup(target);
	}
	else {
		creep.withdraw(target, resourceType || _.keys(target.store)[0]);
	}

	return true;
};

export default PowerHaulerRole;
