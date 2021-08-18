/* global FIND_DROPPED_RESOURCES RESOURCE_ENERGY OK
ERR_NO_PATH ERR_NOT_IN_RANGE FIND_STRUCTURES STRUCTURE_CONTAINER STRUCTURE_ROAD
FIND_MY_CONSTRUCTION_SITES LOOK_STRUCTURES MAX_CONSTRUCTION_SITES
LOOK_CONSTRUCTION_SITES */

// @todo Collect energy if it's lying on the path.

import hivemind from './hivemind';
import utilities from './utilities';
import Role from './role';

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
	if (!hivemind.segmentMemory.isReady()) return;

	if (creep.memory.delivering && creep.carry.energy === 0) {
		this.setHaulerState(creep, false);
	}
	else if (!creep.memory.delivering && _.sum(creep.carry) >= creep.carryCapacity * 0.9) {
		this.setHaulerState(creep, true);
	}

	if (creep.memory.delivering) {
		// Repair / build roads on the way home.

		if (creep.operation) {
			const sourceRoom = creep.operation.getSourceRoom(creep.memory.source);
			if (creep.pos.roomName !== sourceRoom && Game.cpu.bucket > 3000) {
				this.performBuildRoad(creep);
			}
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

	if (!creep.operation) return;

	const paths = creep.operation.getPaths();
	if (!paths[creep.memory.source] || !paths[creep.memory.source].accessible) return;

	creep.setCachedPath(utilities.serializePositionPath(paths[creep.memory.source].path), !delivering, 1);
};

/**
 * Makes a creep deliver resources to another room.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
HaulerRole.prototype.performHaulerDeliver = function (creep) {
	if (!creep.operation) {
		// @todo Operation has probably ended. Return home and suicide?
		return;
	}

	const sourceRoom = creep.operation.getSourceRoom(creep.memory.source);
	const target = Game.rooms[sourceRoom].getBestStorageTarget(creep.store.energy, RESOURCE_ENERGY);
	const targetPosition = target ? target.pos : Game.rooms[sourceRoom].getStorageLocation();

	if (creep.hasCachedPath()) {
		creep.followCachedPath();
		if (creep.hasArrived() || creep.pos.getRangeTo(targetPosition) <= 3) {
			creep.clearCachedPath();
		}
		else {
			return;
		}
	}

	if (targetPosition.roomName !== creep.pos.roomName) {
		creep.moveToRange(targetPosition, 1);

		return;
	}

	// @todo If no storage is available, use default delivery method.
	if (!target || creep.carry.energy > target.store.getFreeCapacity()) {
		// Storage structure is full, drop energy instead.
		const storageLocation = creep.room.getStorageLocation();
		if (!storageLocation) {
			// If there's no place to deliver, just drop the energy on the spot, somebody will probably pick it up.
			if (creep.drop(RESOURCE_ENERGY) === OK) creep.operation.addResourceGain(creep.store.energy, RESOURCE_ENERGY);
			return;
		}

		if (creep.pos.x !== storageLocation.x || creep.pos.y !== storageLocation.y) {
			const result = creep.moveTo(storageLocation.x, storageLocation.y);
			if (result === ERR_NO_PATH && creep.drop(RESOURCE_ENERGY) === OK) {
				// If there's no place to deliver, just drop the energy on the spot, somebody will probably pick it up.
				creep.operation.addResourceGain(creep.store.energy, RESOURCE_ENERGY);
				return;
			}

			const pos = utilities.encodePosition(creep.pos);
			if (creep.memory.lastWaitPosition === pos) {
				creep.memory.lastWaitCount = (creep.memory.lastWaitCount || 0) + 1;
				if (creep.memory.lastWaitCount > 10 && creep.drop(RESOURCE_ENERGY) === OK) {
					// If there's no place to deliver, just drop the energy on the spot, somebody will probably pick it up.
					creep.operation.addResourceGain(creep.store.energy, RESOURCE_ENERGY);
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
			creep.operation.addResourceGain(creep.store.energy, RESOURCE_ENERGY);
			return;
		}
	}

	const result = creep.transfer(target, RESOURCE_ENERGY);
	if (result === OK) {
		creep.operation.addResourceGain(creep.store.energy, RESOURCE_ENERGY);
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
	else if (creep.pos.roomName !== sourcePosition.roomName || creep.pos.getRangeTo(sourcePosition) > 10) {
		// This creep _should_ be on a cached path!
		// It probably just spawned.
		this.setHaulerState(creep, false);
		return;
	}

	if (sourcePosition.roomName !== creep.pos.roomName) {
		creep.moveToRange(sourcePosition, 1);
		return;
	}

	const actionTaken = this.pickupNearbyEnergy(creep);

	// Get energy from target container.
	if (!creep.operation) {
		// @todo Operation has probably ended. Return home and suicide?
		return;
	}

	const sourceRoom = creep.operation.getSourceRoom(creep.memory.source);
	const container = creep.operation.getContainer(creep.memory.source);
	if (container) {
		if (creep.pos.getRangeTo(container) > 1) {
			creep.moveToRange(container, 1);
		}
		else {
			const willFillCreep = (container.store.energy || 0) >= creep.store.getFreeCapacity();
			const relevantAmountReached = (container.store.energy || 0) >= creep.store.getCapacity() / 2;
			if (!actionTaken && (relevantAmountReached || willFillCreep)) {
				creep.withdraw(container, RESOURCE_ENERGY);
			}
		}

		return;
	}

	// If all else fails, make sure we're close enough to our source.
	if (creep.pos.getRangeTo(sourcePosition) > 2) {
		creep.moveToRange(sourcePosition, 2);
	}

	// Repair / build roads, even when just waiting for more energy.
	if (!actionTaken && sourceRoom !== creep.pos.roomName && !creep.room.isMine() && Game.cpu.bucket > 3000) {
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
			filter: resource => resource.resourceType === RESOURCE_ENERGY && resource.amount >= 100,
		});
		if (resources.length > 0) {
			resource = resources[0];
			creep.memory.energyPickupTarget = resource.id;
		}
	}

	if (resource) {
		if (creep.pos.getRangeTo(resource) > 1) {
			creep.moveToRange(resource, 1);
			return false;
		}

		creep.pickup(resource);
		return true;
	}

	return false;
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
	if (workParts === 0) return false;

	if ((creep.store.energy || 0) === 0) return false;

	if (!creep.operation) return false;

	const sourceRoom = creep.operation.getSourceRoom(creep.memory.source);
	const sourceRoomLevel = Game.rooms[sourceRoom] ? Game.rooms[sourceRoom].controller.level : 0;
	const buildRoads = sourceRoomLevel > 3;

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
			if (creep.repair(needsRepair) === OK) {
				creep.operation.addResourceCost(workParts, RESOURCE_ENERGY);
				this.actionTaken = true;
			}

			// If structure is especially damaged, stay here to keep repairing.
			if (needsRepair.hits < needsRepair.hitsMax - (workParts * 2 * 100)) {
				return true;
			}
		}
	}

	// Check source container and repair that, too.
	if (this.ensureRemoteHarvestContainerIsBuilt(creep)) return true;

	const needsBuilding = creep.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES, {
		filter: site => site.structureType === STRUCTURE_CONTAINER || site.structureType === STRUCTURE_ROAD,
	});
	if (needsBuilding && creep.pos.getRangeTo(needsBuilding) <= 3) {
		if (this.actionTaken) {
			// Try again next time.
			return true;
		}

		if (creep.build(needsBuilding) === OK) {
			const buildCost = Math.min(creep.store.energy || 0, workParts * 5, needsBuilding.progressTotal - needsBuilding.progress);
			creep.operation.addResourceCost(buildCost, RESOURCE_ENERGY);
			this.actionTaken = true;
		}

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

	if ((creep.store.energy || 0) === 0) return false;

	const workParts = creep.memory.body.work || 0;
	if (workParts === 0) return false;

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

				if (creep.repair(structure) === OK) {
					creep.operation.addResourceCost(workParts, RESOURCE_ENERGY);
					this.actionTaken = true;
				}

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
					// Stay here to build the new construction site.
					return true;
				}
			}
		}
	}

	return false;
};

/**
 * Repairs or constructs a container near the source we're mining.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 *
 * @return {boolean}
 *   Whether the creep should stay on this spot for further repairs.
 */
HaulerRole.prototype.ensureRemoteHarvestContainerIsBuilt = function (creep: Creep) {
	if ((creep.store.energy || 0) === 0) return false;

	const workParts = creep.memory.body.work || 0;
	if (workParts === 0) return false;

	if (creep.operation.hasContainer()) {
		// Make sure container is in good condition.
		const container = creep.operation.getContainer(creep.memory.source);
		if (creep.pos.getRangeTo(container) > 3 || container.hits > container.hitsMax - (workParts * 100)) return false;

		// Many repairs to do, so stay here for next tick.
		if (this.actionTaken) return true;

		if (creep.repair(container) === OK) {
			creep.operation.addResourceCost(workParts, RESOURCE_ENERGY);
			this.actionTaken = true;
		}

		// If structure is especially damaged, stay here to keep repairing.
		if (container.hits < container.hitsMax - (workParts * 2 * 100)) {
			return true;
		}

		return false;
	}

	// Check if there is a container or construction site nearby.
	const containerPosition: RoomPosition = creep.operation.getContainerPosition(creep.memory.source);
	if (!containerPosition || containerPosition.roomName !== creep.pos.roomName) return false;

	const sites = _.filter(containerPosition.lookFor(LOOK_CONSTRUCTION_SITES), site => site.structureType === STRUCTURE_CONTAINER);
	if (sites.length === 0) {
		// Place a container construction site for this source.
		containerPosition.createConstructionSite(STRUCTURE_CONTAINER);
	}

	return false;
};

export default HaulerRole;
