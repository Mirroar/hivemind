'use strict';

/* global Creep FIND_DROPPED_RESOURCES RESOURCE_ENERGY FIND_CREEPS
ERR_NO_PATH OK ERR_NOT_IN_RANGE */

const utilities = require('./utilities');

// @todo When road is built, send harvester with low move _and_ carry, and let it build a container. Then, send transporters.
// @todo Record time it takes to get to source, so a new harvester can be built in time.
// @todo Collect energy if it's lying on the path.

/**
 * Makes a creep get energy from different rooms.
 */
Creep.prototype.performGetHaulerEnergy = function () {
	const creep = this;
	if (!creep.memory.source) return;

	const sourcePosition = utilities.decodePosition(creep.memory.source);

	if (this.hasCachedPath()) {
		this.followCachedPath();
		if (this.hasArrived()) {
			this.clearCachedPath();
		}
		else if (this.pos.getRangeTo(sourcePosition) <= 3) {
			this.clearCachedPath();
		}
		else {
			return;
		}
	}
	else if (this.pos.getRangeTo(sourcePosition) > 10) {
		// This creep _should_ be on a cached path!
		// It probably just spawned.
		this.setHaulerState(false);
		return;
	}

	if (sourcePosition.roomName !== creep.pos.roomName) {
		creep.moveTo(sourcePosition);
		return;
	}

	let actionTaken = this.pickupNearbyEnergy();

	// Get energy from target container.
	const targetPosition = utilities.decodePosition(creep.memory.storage);
	const harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[creep.memory.source];
	if (harvestMemory.hasContainer) {
		const container = Game.getObjectById(harvestMemory.containerId);

		if (container) {
			if (creep.pos.getRangeTo(container) > 1) {
				creep.moveTo(container);
			}
			else if (!actionTaken) {
				creep.withdraw(container, RESOURCE_ENERGY);
				actionTaken = true;
			}
		}
	}

	// Also lighten the load of harvesters nearby.
	const harvester = sourcePosition.findClosestByRange(FIND_CREEPS, {
		filter: creep => creep.my && creep.memory.role === 'harvester.remote' && creep.carry.energy > creep.carryCapacity * 0.5 && this.pos.getRangeTo(creep) <= 3,
	});
	if (harvester && !actionTaken) {
		if (creep.pos.getRangeTo(harvester) > 1) {
			creep.moveTo(harvester);
		}
		else {
			harvester.transfer(creep, RESOURCE_ENERGY);
		}
	}

	// If all else fails, make sure we're close enough to our source.
	if (this.pos.getRangeTo(sourcePosition) > 2) {
		this.moveTo(sourcePosition);
	}

	// Repair / build roads, even when just waiting for more energy.
	if (!actionTaken && targetPosition.roomName !== this.pos.roomName && (!this.room.controller || !this.room.controller.my) && Game.cpu.bucket > 3000) {
		this.performBuildRoad();
	}
};

/**
 * Picks up dropped energy close to this creep.
 *
 * @return {boolean}
 *   True if a pickup was made this tick.
 */
Creep.prototype.pickupNearbyEnergy = function () {
	// @todo Allow hauler to pick up other resources as well, but respect that
	// when delivering.
	// Check if energy is on the ground nearby and pick that up.
	let resource;
	if (this.memory.energyPickupTarget) {
		resource = Game.getObjectById(this.memory.energyPickupTarget);

		if (!resource) {
			delete this.memory.energyPickupTarget;
		}
		else if (resource.pos.roomName !== this.pos.roomName) {
			resource = null;
			delete this.memory.energyPickupTarget;
		}
	}

	if (!resource) {
		const resources = this.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
			filter: resource => resource.resourceType === RESOURCE_ENERGY,
		});
		if (resources.length > 0) {
			resource = resources[0];
			this.memory.energyPickupTarget = resource.id;
		}
	}

	if (resource) {
		if (this.pos.getRangeTo(resource) > 1) {
			this.moveTo(resource);
			return;
		}

		this.pickup(resource);
		return true;
	}
};

/**
 * Makes a creep deliver resources to another room.
 */
Creep.prototype.performHaulerDeliver = function () {
	const creep = this;
	const targetPosition = utilities.decodePosition(creep.memory.storage);
	const harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[creep.memory.source];

	if (this.hasCachedPath()) {
		this.followCachedPath();
		if (this.hasArrived()) {
			this.clearCachedPath();
		}
		else if (this.pos.getRangeTo(targetPosition) <= 3) {
			this.clearCachedPath();
		}
		else {
			return;
		}
	}

	if (targetPosition.roomName !== creep.pos.roomName) {
		creep.moveTo(targetPosition);

		return;
	}

	// @todo If no storage is available, use default delivery method.
	const target = creep.room.getBestStorageTarget(creep.carry.energy, RESOURCE_ENERGY);
	if (!target || _.sum(target.store) + creep.carry.energy >= target.storeCapacity) {
		// Container is full, drop energy instead.
		const storageLocation = creep.room.getStorageLocation();
		if (storageLocation) {
			if (creep.pos.x !== storageLocation.x || creep.pos.y !== storageLocation.y) {
				const result = creep.moveTo(storageLocation.x, storageLocation.y);
				if (result === ERR_NO_PATH && creep.drop(RESOURCE_ENERGY) === OK) {
					// If there's no place to deliver, just drop the energy on the spot, somebody will probably pick it up.
					harvestMemory.revenue += creep.carry.energy;
					return;
				}

				const pos = utilities.encodePosition(creep.pos);
				if (creep.memory.lastWaitPosition === pos) {
					creep.memory.lastWaitCount = (creep.memory.lastWaitCount || 0) + 1;
					if (creep.memory.lastWaitCount > 10 && creep.drop(RESOURCE_ENERGY) === OK) {
						// If there's no place to deliver, just drop the energy on the spot, somebody will probably pick it up.
						harvestMemory.revenue += creep.carry.energy;
						delete creep.memory.lastWaitCount;
						return;
					}
				}
				else {
					delete creep.memory.lastWaitCount;
					creep.memory.lastWaitPosition = pos;
				}
			}
			else if (creep.drop(RESOURCE_ENERGY) === OK) {
				// Dropoff spot reached, drop energy.
				// If there's no place to deliver, just drop the energy on the spot, somebody will probably pick it up.
				harvestMemory.revenue += creep.carry.energy;
				return;
			}
		}
		else if (creep.drop(RESOURCE_ENERGY) === OK) {
			// If there's no place to deliver, just drop the energy on the spot, somebody will probably pick it up.
			harvestMemory.revenue += creep.carry.energy;
			return;
		}
	}

	const result = creep.transfer(target, RESOURCE_ENERGY);
	if (result === OK) {
		// @todo This might be wrong if energy only fits into container partially.
		harvestMemory.revenue += creep.carry.energy;
	}
	else if (result === ERR_NOT_IN_RANGE) {
		creep.moveTo(target);
	}
};

/**
 * Puts this creep into or out of delivery mode.
 *
 * @param {boolean} delivering
 *   Whether this creep should be delivering it's carried resources.
 */
Creep.prototype.setHaulerState = function (delivering) {
	this.memory.delivering = delivering;

	if (this.memory.source) {
		const targetPosition = utilities.decodePosition(this.memory.storage);
		const harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[this.memory.source];

		if (harvestMemory.cachedPath) {
			this.setCachedPath(harvestMemory.cachedPath.path, delivering, 1);
		}
	}
};

/**
 * Makes a creep behave like a hauler.
 */
Creep.prototype.runHaulerLogic = function () {
	if (this.memory.delivering && this.carry.energy === 0) {
		this.setHaulerState(false);
	}
	else if (!this.memory.delivering && _.sum(this.carry) >= this.carryCapacity * 0.9) {
		this.setHaulerState(true);
	}

	if (this.memory.delivering) {
		// Repair / build roads on the way home.
		const targetPosition = utilities.decodePosition(this.memory.storage);
		if (targetPosition.roomName !== this.pos.roomName && Game.cpu.bucket > 3000) {
			this.performBuildRoad();
		}

		this.performHaulerDeliver();
		return;
	}

	this.performGetHaulerEnergy();
};
