'use strict';

/* global Room RoomPosition RESOURCE_ENERGY LOOK_RESOURCES RESOURCES_ALL
RESOURCE_POWER FIND_STRUCTURES STRUCTURE_LAB */

/**
 * Determines maximum storage capacity within a room.
 *
 * @return {number}
 *   The total storage limit.
 */
Room.prototype.getStorageLimit = function () {
	let total = 0;
	if (this.storage) {
		total += this.storage.storeCapacity;
	}
	else {
		// Assume 10000 storage for dropping stuff on the ground.
		total += 10000;
	}

	if (this.terminal) {
		total += this.terminal.storeCapacity;
	}

	return total;
};

/**
 * Determines amount of currently available storage.
 *
 * @return {number}
 *   The currently available free storage space.
 */
Room.prototype.getFreeStorage = function () {
	// Determines amount of free space in storage.
	let limit = this.getStorageLimit();
	if (this.storage) {
		limit -= _.sum(this.storage.store);
	}

	if (this.terminal) {
		limit -= _.sum(this.terminal.store);
	}

	return limit;
};

/**
 * Determines the amount of a resource currently stored in this room.
 *
 * @param {string} resourceType
 *   The resource in question.
 *
 * @return {number}
 *   Amount of this resource in storage or terminal.
 */
Room.prototype.getCurrentResourceAmount = function (resourceType) {
	let total = 0;
	if (this.storage && this.storage.store[resourceType]) {
		total += this.storage.store[resourceType];
	}

	if (this.terminal && this.terminal.store[resourceType]) {
		total += this.terminal.store[resourceType];
	}

	return total;
};

/**
 * Gets amount of energy stored, taking into account energy on storage location.
 *
 * @return {number}
 *   Amount of energy this room has available.
 */
Room.prototype.getStoredEnergy = function () {
	// @todo Add caching, make sure it's fresh every tick.
	let total = this.getCurrentResourceAmount(RESOURCE_ENERGY);

	const storageLocation = this.getStorageLocation();
	if (!storageLocation) return total;
	const storagePosition = new RoomPosition(storageLocation.x, storageLocation.y, this.name);
	const resources = _.filter(storagePosition.lookFor(LOOK_RESOURCES), resource => resource.resourceType === RESOURCE_ENERGY);
	if (resources.length > 0) {
		total += resources[0].amount;
	}

	return total;
};

/**
 * Gets amount of minerals and mineral compounds stored in a room.
 *
 * @return {number}
 *   Amount of minerals stored in this room.
 */
Room.prototype.getCurrentMineralAmount = function () {
	// @todo This could use caching.
	let total = 0;

	for (const resourceType of RESOURCES_ALL) {
		if (resourceType === RESOURCE_ENERGY || resourceType === RESOURCE_POWER) continue;
		total += this.getCurrentResourceAmount(resourceType);
	}

	return total;
};

/**
 * Decides whether a room's storage has too much energy.
 *
 * @return {boolean}
 *   True if storage limit for energy has been reached.
 */
Room.prototype.isFullOnEnergy = function () {
	return this.getCurrentResourceAmount(RESOURCE_ENERGY) > this.getStorageLimit() / 2;
};

/**
 * Decides whether a room's storage has too much power.
 *
 * @return {boolean}
 *   True if storage limit for power has been reached.
 */
Room.prototype.isFullOnPower = function () {
	return this.getCurrentResourceAmount(RESOURCE_POWER) > this.getStorageLimit() / 6;
};

/**
 * Decides whether a room's storage has too many minerals.
 *
 * @return {boolean}
 *   True if storage limit for minerals has been reached.
 */
Room.prototype.isFullOnMinerals = function () {
	return this.getCurrentMineralAmount() > this.getStorageLimit() / 3;
};

/**
 * Decides whether a room's storage has too much of a resource.
 *
 * @param {string} resourceType
 *   Type of the resource we want to check.
 *
 * @return {boolean}
 *   True if storage limit for the resource has been reached.
 */
Room.prototype.isFullOn = function (resourceType) {
	if (resourceType === RESOURCE_ENERGY) return this.isFullOnEnergy();
	if (resourceType === RESOURCE_POWER) return this.isFullOnPower();
	return this.isFullOnMinerals();
};

/**
 * Determines a room's storage location, where we drop energy as long as no
 * storage has been built yet.
 *
 * @return {RoomPosition}
 *   Returns the room's storage location.
 */
Room.prototype.getStorageLocation = function () {
	if (!this.controller) return;
	if (this.roomPlanner) return this.roomPlanner.getRoomCenter();
};

/**
 * Saves the order to move a certain amount of resources to the terminal.
 *
 * @param {string} resourceType
 *   The type of resource to store.
 * @param {number} amount
 *   Amount of resources to store.
 */
Room.prototype.prepareForTrading = function (resourceType, amount) {
	if (!amount) amount = 10000;
	this.memory.fillTerminal = resourceType;
	this.memory.fillTerminalAmount = Math.min(amount, 50000);
};

/**
 * Stops deliberately storing resources in the room's terminal.
 */
Room.prototype.stopTradePreparation = function () {
	delete this.memory.fillTerminal;
	delete this.memory.fillTerminalAmount;
};

/**
 * Gets a list of remote mining targets designated for this room.
 *
 * @return {Array}
 *   An array of objects containing information about remote harvest stargets.
 */
Room.prototype.getRemoteHarvestTargets = function () {
	// @todo Cache this if we use it during spawning.

	if (!Memory.strategy) return [];
	const memory = Memory.strategy;

	const targets = [];

	for (const info of _.values(memory.roomList)) {
		if (info.origin !== this.name) continue;
		if (!info.harvestActive) continue;

		targets.push(info);
	}

	return targets;
};

/**
 * Gathers resource amounts for a room.
 *
 * @return {object}
 *   An object containing information about this room's resources:
 *   - totalResources: Resource amounts keyed by resource type.
 *   - state: Resource thresholds, namely `low`, `medium`, `high` and
 *     `excessive` keyed by resource type.
 *   - canTrade: Whether the room can perform trades.
 */
Room.prototype.getResourceState = function () {
	if (!this.controller || !this.controller.my) return;

	const storage = this.storage;
	const terminal = this.terminal;

	const roomData = {
		totalResources: {},
		state: {},
		canTrade: false,
		addResource(resourceType, amount) {
			this.totalResources[resourceType] = (this.totalResources[resourceType] || 0) + amount;
		},
	};
	if (storage && terminal) {
		roomData.canTrade = true;
	}

	// @todo Remove in favor of function.
	roomData.isEvacuating = this.isEvacuating();

	if (storage && !roomData.isEvacuating) {
		_.each(storage.store, (amount, resourceType) => {
			roomData.addResource(resourceType, amount);
		});
	}

	if (terminal) {
		_.each(terminal.store, (amount, resourceType) => {
			roomData.addResource(resourceType, amount);
		});
	}

	if (this.mineral && !roomData.isEvacuating) {
		roomData.mineralType = this.mineral.mineralType;
	}

	// Add resources in labs as well.
	if (this.memory.labs && !roomData.isEvacuating) {
		const labs = this.find(FIND_STRUCTURES, s => s.structureType === STRUCTURE_LAB);

		for (const lab of labs) {
			if (lab.mineralType && lab.mineralAmount > 0) {
				roomData.addResource(lab.mineralType, lab.mineralAmount);
			}
		}
	}

	_.each(roomData.totalResources, (amount, resourceType) => {
		if (resourceType === RESOURCE_ENERGY) {
			if (amount >= 350000) {
				roomData.state[resourceType] = 'excessive';
			}
			else if (amount >= 200000) {
				roomData.state[resourceType] = 'high';
			}
			else if (amount >= 100000) {
				roomData.state[resourceType] = 'medium';
			}
			else {
				roomData.state[resourceType] = 'low';
			}

			return;
		}

		if (amount >= 220000) {
			roomData.state[resourceType] = 'excessive';
		}
		else if (amount >= 30000) {
			roomData.state[resourceType] = 'high';
		}
		else if (amount >= 10000) {
			roomData.state[resourceType] = 'medium';
		}
		else {
			roomData.state[resourceType] = 'low';
		}
	});

	return roomData;
};

/**
 * Determines the best place to store resources.
 *
 * @param {number} amount
 *   Amount of resources to store.
 * @param {string} resourceType
 *   Type of resource to store.
 *
 * @return {Structure}
 *   The room's storage or terminal.
 */
Room.prototype.getBestStorageTarget = function (amount, resourceType) {
	if (this.storage && this.terminal) {
		const storageFree = this.storage.storeCapacity - _.sum(this.storage.store);
		const terminalFree = this.terminal.storeCapacity - _.sum(this.terminal.store);
		if (this.isEvacuating() && terminalFree > this.terminal.storeCapacity * 0.2) {
			// If we're evacuating, store everything in terminal to be sent away.
			return this.terminal;
		}

		if (this.isClearingTerminal() && storageFree > this.storage.storeCapacity * 0.2) {
			// If we're clearing out the terminal, put everything into storage.
			return this.storage;
		}

		if (!resourceType) {
			if (_.sum(this.storage.store) / this.storage.storeCapacity < _.sum(this.terminal.store) / this.terminal.storeCapacity) {
				return this.storage;
			}

			return this.terminal;
		}

		if (storageFree >= amount && terminalFree >= amount && (this.storage.store[resourceType] || 0) / storageFree < (this.terminal.store[resourceType] || 0) / terminalFree) {
			return this.storage;
		}

		if (terminalFree >= amount) {
			return this.terminal;
		}

		if (storageFree >= amount) {
			return this.storage;
		}
	}
	else if (this.storage) {
		return this.storage;
	}
	else if (this.terminal) {
		return this.terminal;
	}
};

/**
 * Determines the best place to get resources from.
 *
 * @param {string} resourceType
 *   The type of resource to get.
 *
 * @return {Structure}
 *   The room's storage or terminal.
 */
Room.prototype.getBestStorageSource = function (resourceType) {
	if (this.storage && this.terminal) {
		const specialSource = this.getBestCircumstancialStorageSource(resourceType);
		if (specialSource) return specialSource;

		if ((this.storage.store[resourceType] || 0) / this.storage.storeCapacity < (this.terminal.store[resourceType]) / this.terminal.storeCapacity) {
			if (this.memory.fillTerminal !== resourceType) {
				return this.terminal;
			}
		}

		if ((this.storage.store[resourceType] || 0) > 0) {
			return this.storage;
		}
	}
	else if (this.storage && this.storage.store[resourceType]) {
		return this.storage;
	}
	else if (this.terminal && this.terminal.store[resourceType] && this.memory.fillTerminal !== resourceType) {
		return this.terminal;
	}
};

/**
 * Determines the best place to get resources from when special rules apply.
 *
 * This is the case when a room is evacuating or a terminal is being emptied.
 *
 * @param {string} resourceType
 *   The type of resource to get.
 *
 * @return {Structure}
 *   The room's storage or terminal.
 */
Room.prototype.getBestCircumstancialStorageSource = function (resourceType) {
	let primarySource;
	let secondarySource;
	if (this.isEvacuating()) {
		// Take resources out of storage if possible to empty it out.
		primarySource = this.storage;
		secondarySource = this.terminal;
	}
	else if (this.isClearingTerminal()) {
		// Take resources out of terminal if possible to empty it out.
		primarySource = this.terminal;
		secondarySource = this.storage;
	}

	if (primarySource) {
		const secondaryFull = _.sum(secondarySource.store) > secondarySource.storeCapacity * 0.8;

		if (primarySource.store[resourceType] && (!secondaryFull || !secondarySource.store[resourceType])) {
			return primarySource;
		}

		if (secondarySource.store[resourceType] && (resourceType === RESOURCE_ENERGY || secondaryFull)) {
			return secondarySource;
		}
	}
};
