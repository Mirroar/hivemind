'use strict';

/* global Creep LOOK_STRUCTURES STRUCTURE_ROAD MAX_CONSTRUCTION_SITES OK
LOOK_CONSTRUCTION_SITES FIND_SOURCES FIND_STRUCTURES STRUCTURE_CONTAINER
FIND_MY_CONSTRUCTION_SITES RESOURCE_ENERGY */

const utilities = require('./utilities');
const Role = require('./role');

const RemoteHarvesterRole = function () {
	Role.call(this);

	// Remote harvesters have slighly higher priority, since they don't use much
	// cpu once they are harvesting.
	this.throttleAt = 5000;
	this.stopAt = 2000;
};

RemoteHarvesterRole.prototype = Object.create(Role.prototype);

// @todo When road is built, send harvester with low move _and_ carry, and let it build a container. Then, send transporters.
// @todo Collect energy if it's lying on the path.

/**
 * Makes a creep behave like a remote harvester.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
RemoteHarvesterRole.prototype.run = function (creep) {
	if (!creep.memory.harvesting && creep.carry.energy === 0) {
		this.setRemoteHarvestState(creep, true);
	}
	else if (creep.memory.harvesting && creep.carry.energy === creep.carryCapacity) {
		this.setRemoteHarvestState(creep, false);
	}

	if (creep.memory.harvesting) {
		this.stopTravelTimer(creep);
		this.performRemoteHarvest(creep);
		return;
	}

	this.performRemoteHarvesterDeliver(creep);
};

/**
 * Puts this creep into or out of remote harvesting mode.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 * @param {boolean} harvesting
 *   Whether or not the creep should be harvesting right now.
 */
RemoteHarvesterRole.prototype.setRemoteHarvestState = function (creep, harvesting) {
	creep.memory.harvesting = harvesting;

	const targetPosition = utilities.decodePosition(creep.memory.storage);
	const harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[creep.memory.source];
	if (harvesting) {
		this.startTravelTimer(creep);
	}
	else {
		// Check if there is a container near the source, and save it.
		const container = creep.pos.findClosestByRange(FIND_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_CONTAINER,
		});
		if (container && creep.pos.getRangeTo(container) <= 3) {
			harvestMemory.hasContainer = true;
			harvestMemory.containerId = container.id;
		}
		else {
			harvestMemory.hasContainer = false;
			delete harvestMemory.containerId;
		}
	}

	if (!harvestMemory.cachedPath) {
		// Try precalculating the path back home if it doesn't exist yet.
		const room = Game.rooms[targetPosition.roomName];
		const sourceFlag = {pos: utilities.decodePosition(creep.memory.source)};
		utilities.precalculatePaths(room, sourceFlag.pos);
	}

	if (harvestMemory.cachedPath) {
		creep.setCachedPath(harvestMemory.cachedPath.path, !harvesting, 1);
	}
};

/**
 * Makes the creep harvest resources outside of owned rooms.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
RemoteHarvesterRole.prototype.performRemoteHarvest = function (creep) {
	let source;
	const sourcePosition = utilities.decodePosition(creep.memory.source);

	if (creep.hasCachedPath()) {
		if (creep.hasArrived() || creep.pos.getRangeTo(sourcePosition) < 3) {
			creep.clearCachedPath();
		}
		else {
			if (!this.removeObstacles(creep)) creep.followCachedPath();
			return;
		}
	}

	if (sourcePosition.roomName !== creep.pos.roomName) {
		creep.moveTo(sourcePosition);
		return;
	}

	// Check if a container nearby is in need of repairs, since we can handle
	// it better than haulers do.
	const workParts = creep.memory.body.work || 0;
	const needsRepair = creep.pos.findClosestByRange(FIND_STRUCTURES, {
		filter: structure => (structure.structureType === STRUCTURE_CONTAINER) && structure.hits <= structure.hitsMax - (workParts * 100),
	});
	if (needsRepair && creep.pos.getRangeTo(needsRepair) <= 3) {
		if (creep.carry.energy >= workParts && workParts > 0) {
			Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[creep.memory.source].buildCost += workParts;
			creep.repair(needsRepair);

			return;
		}
	}

	const sources = creep.room.find(FIND_SOURCES, {
		filter: source => source.pos.x === sourcePosition.x && source.pos.y === sourcePosition.y,
	});
	if (sources.length > 0) {
		source = sources[0];
	}
	else {
		// @todo Send notification that source is somehow unavailable?
		this.setRemoteHarvestState(creep, false);
		return;
	}

	if (source.energy <= 0 && creep.carry.energy > 0) {
		// Source is depleted, start delivering early.
		this.setRemoteHarvestState(creep, false);
		return;
	}

	if (creep.pos.getRangeTo(source) > 1) {
		creep.moveTo(source);
	}
	else {
		creep.harvest(source);
	}

	// Immediately deposit energy if a container is nearby.
	const targetPosition = utilities.decodePosition(creep.memory.storage);
	const harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[creep.memory.source];
	if (harvestMemory.hasContainer) {
		const container = Game.getObjectById(harvestMemory.containerId);
		if (_.sum(creep.carry) >= creep.carryCapacity * 0.5 && creep.pos.getRangeTo(container) <= 1) {
			creep.transfer(container, RESOURCE_ENERGY);
		}
	}
};

/**
 * Tries to remove obstacles on the calculated path.
 * @todo Test this better.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 *
 * @return {boolean}
 *   Whether the creep is busy dismantling an obstacle.
 */
RemoteHarvesterRole.prototype.removeObstacles = function (creep) {
	const workParts = creep.memory.body.work;

	if (workParts < 1) return false;

	if (!creep.memory.cachedPath) return false;

	const pos = creep.memory.cachedPath.position;
	const i = pos + 1;
	const path = creep.getCachedPath();

	if (i >= path.length) return false;

	const position = path[i];
	if (!position || position.roomName !== creep.pos.roomName) return false;

	// Check for obstacles on the next position to destroy.
	const structures = position.lookFor(LOOK_STRUCTURES);
	if (structures.length === 0) return false;

	for (const j in structures) {
		if (structures[j].structureType !== STRUCTURE_ROAD && structures[j].structureType !== STRUCTURE_CONTAINER && !structures[j].my) {
			creep.dismantle(structures[j]);
			return true;
		}
	}
};

/**
 * Makes the creep deliver remotely harvested resources.
 * @todo Reduce this function since remote harvesters are not meant to return.
 */
RemoteHarvesterRole.prototype.performRemoteHarvesterDeliver = function (creep) {
	const targetPosition = utilities.decodePosition(creep.memory.storage);
	const harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[creep.memory.source];
	if (harvestMemory.hasContainer) {
		const container = Game.getObjectById(harvestMemory.containerId);
		if (container) {
			if (creep.pos.getRangeTo(container) > 1) {
				creep.moveTo(container);
			}
			else {
				creep.transfer(container, RESOURCE_ENERGY);
			}

			if (_.sum(container.store) >= container.storeCapacity) {
				// Just drop energy right here, somebody will pick it up later, right?
				creep.drop(RESOURCE_ENERGY);
			}

			return;
		}

		harvestMemory.hasContainer = false;
		delete harvestMemory.containerId;
	}

	if (targetPosition.roomName !== creep.pos.roomName) {
		if (creep.hasCachedPath()) {
			if (creep.performBuildRoad()) {
				return;
			}
		}
		else {
			this.setRemoteHarvestState(creep, true);
			return;
		}
	}

	if (creep.hasCachedPath()) {
		creep.followCachedPath();
		if (creep.hasArrived()) {
			creep.clearCachedPath();
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
	const target = creep.room.storage;

	if (!target || _.sum(target.store) + creep.carry.energy >= target.storeCapacity) {
		// Container is full, drop energy instead.
		if (creep.drop(RESOURCE_ENERGY) === OK) {
			harvestMemory.revenue += creep.carry.energy;
			return;
		}
	}

	if (creep.pos.getRangeTo(target) > 1) {
		creep.moveTo(target);
	}
	else {
		const result = creep.transfer(target, RESOURCE_ENERGY);
		if (result === OK) {
			harvestMemory.revenue += creep.carry.energy;
		}
	}
};

/**
 *
 */
RemoteHarvesterRole.prototype.startTravelTimer = function (creep) {
	if (!creep.memory.travelTimer) {
		creep.memory.travelTimer = {
			start: Game.time,
		};
	}
};

/**
 *
 */
RemoteHarvesterRole.prototype.stopTravelTimer = function (creep) {
	const harvestMemory = Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[creep.memory.source];
	if (!creep.memory.travelTimer.end) {
		// Check if we're close to our target.
		const sourcePos = utilities.decodePosition(creep.memory.source);
		if (creep.pos.roomName === sourcePos.roomName && creep.pos.getRangeTo(sourcePos) <= 3) {
			creep.memory.travelTimer.end = Game.time;
			if (!harvestMemory) return;

			if (harvestMemory.travelTime) {
				harvestMemory.travelTime = (harvestMemory.travelTime + creep.memory.travelTimer.end - creep.memory.travelTimer.start) / 2;
			}
			else {
				harvestMemory.travelTime = creep.memory.travelTimer.end - creep.memory.travelTimer.start;
			}
		}
	}
};

module.exports = RemoteHarvesterRole;
