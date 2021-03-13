'use strict';

/* global FIND_DROPPED_RESOURCES RESOURCE_ENERGY FIND_CREEPS FIND_SOURCES
ERR_NO_PATH OK ERR_NOT_IN_RANGE FIND_STRUCTURES STRUCTURE_CONTAINER
FIND_MY_CONSTRUCTION_SITES STRUCTURE_ROAD LOOK_STRUCTURES MAX_CONSTRUCTION_SITES
LOOK_CONSTRUCTION_SITES */

// @todo When road is built, send harvester with low move _and_ carry, and let it build a container. Then, send transporters.
// @todo Record time it takes to get to source, so a new harvester can be built in time.
// @todo Collect energy if it's lying on the path.

const utilities = require('./utilities');
const Role = require('./role');

const HaulerRole = function () {
	Role.call(this);
};

HaulerRole.prototype = Object.create(Role.prototype);

/**
 * Makes a creep behave like a hauler.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
HaulerRole.prototype.run = function (creep) {
	if (creep.memory.delivering && creep.carry.energy === 0) {
		this.setHaulerState(creep, false);
	}
	else if (!creep.memory.delivering && _.sum(creep.carry) >= creep.carryCapacity * 0.9) {
		this.setHaulerState(creep, true);
	}

	if (creep.memory.delivering) {
		// Repair / build roads on the way home.
		const targetPosition = utilities.decodePosition(creep.memory.storage);
		if (targetPosition.roomName !== creep.pos.roomName && Game.cpu.bucket > 3000) {
			this.performBuildRoad(creep);
		}

		this.performHaulerDeliver(creep);
		return;
	}

	this.performGetHaulerEnergy(creep);
};

/**
 * Puts this creep into or out of delivery mode.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 * @param {boolean} delivering
 *   Whether this creep should be delivering it's carried resources.
 */
HaulerRole.prototype.setHaulerState = function (creep, delivering) {
	creep.memory.delivering = delivering;

	if (creep.memory.source) {
		const targetPosition = utilities.decodePosition(creep.memory.storage);
		const harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[creep.memory.source];

		if (harvestMemory.cachedPath) {
			creep.setCachedPath(harvestMemory.cachedPath.path, delivering, 1);
		}
	}
};

/**
 * Makes a creep deliver resources to another room.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
HaulerRole.prototype.performHaulerDeliver = function (creep) {
	const targetPosition = utilities.decodePosition(creep.memory.storage);
	const harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[creep.memory.source];

	if (creep.hasCachedPath()) {
		creep.followCachedPath();
		if (creep.hasArrived()) {
			creep.clearCachedPath();
		}
		else if (creep.pos.getRangeTo(targetPosition) <= 3) {
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
 * Makes a creep get energy from different rooms.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
HaulerRole.prototype.performGetHaulerEnergy = function (creep) {
	if (!creep.memory.source) return;

	const sourcePosition = utilities.decodePosition(creep.memory.source);

	if (creep.hasCachedPath()) {
		creep.followCachedPath();
		if (creep.hasArrived()) {
			creep.clearCachedPath();
		}
		else if (creep.pos.getRangeTo(sourcePosition) <= 3) {
			creep.clearCachedPath();
		}
		else {
			return;
		}
	}
	else if (creep.pos.getRangeTo(sourcePosition) > 10) {
		// This creep _should_ be on a cached path!
		// It probably just spawned.
		this.setHaulerState(creep, false);
		return;
	}

	if (sourcePosition.roomName !== creep.pos.roomName) {
		creep.moveTo(sourcePosition);
		return;
	}

	let actionTaken = this.pickupNearbyEnergy(creep);

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
		filter: harvester => harvester.my && harvester.memory.role === 'harvester.remote' && harvester.carry.energy > harvester.carryCapacity * 0.5 && creep.pos.getRangeTo(harvester) <= 3,
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
	if (creep.pos.getRangeTo(sourcePosition) > 2) {
		creep.moveTo(sourcePosition);
	}

	// Repair / build roads, even when just waiting for more energy.
	if (!actionTaken && targetPosition.roomName !== creep.pos.roomName && !creep.room.isMine() && Game.cpu.bucket > 3000) {
		this.performBuildRoad(creep);
	}
};

/**
 * Picks up dropped energy close to this creep.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 *
 * @return {boolean}
 *   True if a pickup was made this tick.
 */
HaulerRole.prototype.pickupNearbyEnergy = function (creep) {
	// @todo Allow hauler to pick up other resources as well, but respect that
	// when delivering.
	// Check if energy is on the ground nearby and pick that up.
	let resource;
	if (creep.memory.energyPickupTarget) {
		resource = Game.getObjectById(creep.memory.energyPickupTarget);

		if (!resource) {
			delete creep.memory.energyPickupTarget;
		}
		else if (resource.pos.roomName !== creep.pos.roomName) {
			resource = null;
			delete creep.memory.energyPickupTarget;
		}
	}

	if (!resource) {
		// @todo Check if there's a valid (short) path to the resource.
		const resources = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
			filter: resource => resource.resourceType === RESOURCE_ENERGY,
		});
		if (resources.length > 0) {
			resource = resources[0];
			creep.memory.energyPickupTarget = resource.id;
		}
	}

	if (resource) {
		if (creep.pos.getRangeTo(resource) > 1) {
			creep.moveTo(resource);
			return;
		}

		creep.pickup(resource);
		return true;
	}
};

/**
 * Makes the creep build a road under itself on its way home.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 *
 * @return {boolean}
 *   Whether or not an action for building this road has been taken.
 */
HaulerRole.prototype.performBuildRoad = function (creep) {
	const workParts = creep.memory.body.work || 0;
	const sourceRoom = utilities.decodePosition(creep.memory.storage).roomName;
	const sourceRoomLevel = Game.rooms[sourceRoom] ? Game.rooms[sourceRoom].controller.level : 0;
	const buildRoads = sourceRoomLevel > 3;

	if (workParts === 0) return false;

	this.actionTaken = false;

	if (creep.memory.cachedPath && buildRoads) {
		if (this.buildRoadOnCachedPath(creep)) return true;
	}
	else {
		// Repair structures in passing.
		const needsRepair = creep.pos.findClosestByRange(FIND_STRUCTURES, {
			filter: structure => (structure.structureType === STRUCTURE_ROAD || structure.structureType === STRUCTURE_CONTAINER) && structure.hits < structure.hitsMax - (workParts * 100),
		});
		if (needsRepair && creep.pos.getRangeTo(needsRepair) <= 3) {
			Memory.rooms[sourceRoom].remoteHarvesting[creep.memory.source].buildCost += workParts;
			creep.repair(needsRepair);
			this.actionTaken = true;
			// If structure is especially damaged, stay here to keep repairing.
			if (needsRepair.hits < needsRepair.hitsMax - (workParts * 2 * 100)) {
				return true;
			}
		}
	}

	// Check source container and repair that, too.
	const sourcePosition = utilities.decodePosition(creep.memory.source);
	const sources = creep.room.find(FIND_SOURCES, {
		filter: source => source.pos.x === sourcePosition.x && source.pos.y === sourcePosition.y,
	});

	if (sources.length > 0) {
		if (this.ensureRemoteHarvestContainerIsBuilt(creep, sources[0])) return true;
	}

	const needsBuilding = creep.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES, {
		filter: site => site.structureType === STRUCTURE_ROAD || site.structureType === STRUCTURE_CONTAINER,
	});
	if (needsBuilding && creep.pos.getRangeTo(needsBuilding) <= 3) {
		if (this.actionTaken) {
			// Try again next time.
			return true;
		}

		creep.build(needsBuilding);

		const buildCost = Math.min(creep.carry.energy, workParts * 5, needsBuilding.progressTotal - needsBuilding.progress);
		Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[creep.memory.source].buildCost += buildCost;
		this.actionTaken = true;

		// Stay here if more building is needed.
		if (needsBuilding.progressTotal - needsBuilding.progress > workParts * 10) {
			return true;
		}
	}

	return false;
};

/**
 * Builds and repairs roads along the creep's cached path.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 *
 * @return {boolean}
 *   Whether the creep should stay on this spot for further repairs.
 */
HaulerRole.prototype.buildRoadOnCachedPath = function (creep) {
	// Don't try to build roads in owned rooms.
	// If it's another player's, we can't build anyway. If if it's our own,
	// the room planner should handle everything.
	if (creep.room.controller && creep.room.controller.owner) return false;

	const workParts = creep.memory.body.work || 0;
	const pos = creep.memory.cachedPath.position;
	const path = creep.getCachedPath();

	for (let i = pos - 2; i <= pos + 2; i++) {
		if (i < 0 || i >= path.length) continue;

		const position = path[i];
		if (position.roomName !== creep.pos.roomName) continue;

		// Check for roads around the current path position to repair.
		let tileHasRoad = false;
		const structures = position.lookFor(LOOK_STRUCTURES);
		for (const structure of structures) {
			if (structure.structureType !== STRUCTURE_ROAD) continue;

			tileHasRoad = true;

			if (structure.hits < structure.hitsMax - (workParts * 100)) {
				// Many repairs to do, so stay here for next tick.
				if (this.actionTaken) return true;

				Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[creep.memory.source].buildCost += workParts;
				creep.repair(structure);
				this.actionTaken = true;
				// If structure is especially damaged, stay here to keep repairing.
				if (structure.hits < structure.hitsMax - (workParts * 2 * 100)) {
					return true;
				}

				break;
			}
		}

		if (!tileHasRoad && _.size(Game.constructionSites) < MAX_CONSTRUCTION_SITES * 0.7) {
			const sites = position.lookFor(LOOK_CONSTRUCTION_SITES);
			const numSites = _.filter(Game.constructionSites, site => site.pos.roomName === position.roomName).length;
			if (sites.length === 0 && numSites < 5) {
				if (position.createConstructionSite(STRUCTURE_ROAD) === OK) {
					return true;
				}
			}
		}
	}
};

/**
 * Repairs or constructs a container near the source we're mining.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 * @param {Source} source
 *   The source we're checking.
 *
 * @return {boolean}
 *   Whether the creep should stay on this spot for further repairs.
 */
HaulerRole.prototype.ensureRemoteHarvestContainerIsBuilt = function (creep, source) {
	const workParts = creep.memory.body.work || 0;

	// Check if container is built at target location.
	const container = source.getNearbyContainer();
	if (container) {
		if (creep.pos.getRangeTo(container) <= 3 && container.hits < container.hitsMax - (workParts * 100)) {
			// Many repairs to do, so stay here for next tick.
			if (this.actionTaken) return true;

			Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[creep.memory.source].buildCost += workParts;
			creep.repair(container);
			this.actionTaken = true;
			// If structure is especially damaged, stay here to keep repairing.
			if (container.hits < container.hitsMax - (workParts * 2 * 100)) {
				return true;
			}
		}
	}
	else {
		// Check if there is a container or construction site nearby.
		const structures = source.pos.findInRange(FIND_STRUCTURES, 3, {
			filter: structure => structure.structureType === STRUCTURE_CONTAINER,
		});
		const sites = source.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 3, {
			filter: site => site.structureType === STRUCTURE_CONTAINER,
		});
		if (structures.length === 0 && sites.length === 0) {
			// Place a container construction site for this source.
			const targetPosition = utilities.decodePosition(creep.memory.storage);
			const harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[creep.memory.source];

			if (harvestMemory.cachedPath) {
				const path = utilities.deserializePositionPath(harvestMemory.cachedPath.path);
				const containerPosition = path[path.length - 2];
				containerPosition.createConstructionSite(STRUCTURE_CONTAINER);
			}
		}
	}
};

module.exports = HaulerRole;
