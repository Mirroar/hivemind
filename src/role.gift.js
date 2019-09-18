'use strict';

const Role = require('./role');

const GiftRole = function () {
	Role.call(this);
};

GiftRole.prototype = Object.create(Role.prototype);

/**
 * Makes this creep take excess resources from storage.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
GiftRole.prototype.run = function (creep) {
	const storage = creep.room.storage;
	if (!storage) {
		// Nothing to gift if we have no storage.
		this.performGiftTransport(creep);
		return;
	}

	if (_.sum(creep.carry) >= creep.carryCapacity * 0.95) {
		// If we're (nearly) full, embark.
		this.performGiftTransport(creep);
		return;
	}

	if (!creep.memory.targetResource) {
		this.chooseGiftResource(creep);
		return;
	}

	if (!storage.store[creep.memory.targetResource] || storage.store[creep.memory.targetResource] <= 0) {
		this.chooseGiftResource(creep);
		return;
	}

	if (creep.pos.getRangeTo(storage) > 1) {
		creep.moveToRange(storage, 1);
		return;
	}

	creep.withdraw(storage, creep.memory.targetResource);
	delete creep.memory.targetResource;
};

/**
 * Chooses a resource the room is overly full on.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
GiftRole.prototype.chooseGiftResource = function (creep) {
	let tryCount = 0;
	let resourceType = null;
	const resourceTypes = Object.keys(creep.room.storage.store);
	do {
		resourceType = _.sample(resourceTypes);
		tryCount++;
	} while (tryCount < 10 && !creep.room.isFullOn(resourceType));

	creep.memory.targetResource = resourceType;
};

/**
 * Move the creep out of the room by letting it scout.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
GiftRole.prototype.performGiftTransport = function (creep) {
	// Do not send notifications when attacked - we mean to suicide.
	creep.notifyWhenAttacked(false);

	// @todo Move to a nearby owned room with enough space left.
	// @todo Move to a known enemy room and suicide.
	creep.memory.role = 'scout';
};

module.exports = GiftRole;
