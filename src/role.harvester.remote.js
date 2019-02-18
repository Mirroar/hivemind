'use strict';

/* global Creep LOOK_STRUCTURES STRUCTURE_ROAD MAX_CONSTRUCTION_SITES OK
LOOK_CONSTRUCTION_SITES FIND_SOURCES FIND_STRUCTURES STRUCTURE_CONTAINER
FIND_MY_CONSTRUCTION_SITES RESOURCE_ENERGY */

const utilities = require('./utilities');

// @todo When road is built, send harvester with low move _and_ carry, and let it build a container. Then, send transporters.
// @todo Collect energy if it's lying on the path.

/**
 * Makes the creep build a road under itself on its way home.
 *
 * @return {boolean}
 *   Whether or not an action for building this road has been taken.
 */
Creep.prototype.performBuildRoad = function () {
	const creep = this;
	const workParts = creep.memory.body.work || 0;

	if (workParts === 0) return false;

	this.actionTaken = false;

	if (creep.memory.cachedPath) {
		if (this.buildRoadOnCachedPath()) return true;
	}
	else {
		// Repair structures in passing.
		const needsRepair = creep.pos.findClosestByRange(FIND_STRUCTURES, {
			filter: structure => (structure.structureType === STRUCTURE_ROAD || structure.structureType === STRUCTURE_CONTAINER) && structure.hits < structure.hitsMax - (workParts * 100),
		});
		if (needsRepair && creep.pos.getRangeTo(needsRepair) <= 3) {
			Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[creep.memory.source].buildCost += workParts;
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
		if (this.ensureRemoteHarvestContainerIsBuilt(sources[0])) return true;
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
 * @return {boolean}
 *   Whether the creep should stay on this spot for further repairs.
 */
Creep.prototype.buildRoadOnCachedPath = function () {
	const creep = this;
	const workParts = creep.memory.body.work || 0;
	const pos = creep.memory.cachedPath.position;
	for (let i = pos - 2; i <= pos + 2; i++) {
		if (i < 0 || i >= creep.memory.cachedPath.path.length) continue;

		const position = utilities.decodePosition(creep.memory.cachedPath.path[i]);
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
 * @param {Source} source
 *   The source we're checking.
 *
 * @return {boolean}
 *   Whether the creep should stay on this spot for further repairs.
 */
Creep.prototype.ensureRemoteHarvestContainerIsBuilt = function (source) {
	const creep = this;
	const workParts = creep.memory.body.work || 0;

	// Check if container is built at target location.
	const container = source.getNearbyContainer();
	if (container) {
		if (this.pos.getRangeTo(container) <= 3 && container.hits < container.hitsMax - (workParts * 100)) {
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
			const targetPosition = utilities.decodePosition(this.memory.storage);
			const harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[this.memory.source];

			if (harvestMemory.cachedPath) {
				const path = harvestMemory.cachedPath.path;
				const containerPosition = utilities.decodePosition(path[path.length - 2]);
				containerPosition.createConstructionSite(STRUCTURE_CONTAINER);
			}
		}
	}
};

/**
 * Tries to remove obstacles on the calculated path.
 * @todo Test this better.
 *
 * @return {boolean}
 *   Whether the creep is busy dismantling an obstacle.
 */
Creep.prototype.removeObstacles = function () {
	const creep = this;
	const workParts = creep.memory.body.work;

	if (workParts < 1) return false;

	if (!creep.memory.cachedPath) return false;

	const pos = creep.memory.cachedPath.position;
	const i = pos + 1;

	if (i >= creep.memory.cachedPath.path.length) return false;

	const position = utilities.decodePosition(creep.memory.cachedPath.path[i]);
	if (!position || position.roomName !== creep.pos.roomName) return false;

	// Check for obstacles on the next position to destroy.
	const structures = position.lookFor(LOOK_STRUCTURES);
	if (structures.length === 0) return false;

	for (const j in structures) {
		if (structures[j].structureType !== STRUCTURE_ROAD && structures[j].structureType !== STRUCTURE_CONTAINER && !structures[j].my) {
			this.dismantle(structures[j]);
			console.log('dismantle', structures[j]);
			return true;
		}
	}
};

/**
 * Makes the creep harvest resources outside of owned rooms.
 */
Creep.prototype.performRemoteHarvest = function () {
	const creep = this;
	let source;
	const sourcePosition = utilities.decodePosition(creep.memory.source);

	if (this.hasCachedPath()) {
		if (this.hasArrived() || this.pos.getRangeTo(sourcePosition) < 3) {
			this.clearCachedPath();
		}
		else {
			if (!this.removeObstacles()) this.followCachedPath();
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
		creep.setRemoteHarvestState(false);
		return;
	}

	if (source.energy <= 0 && creep.carry.energy > 0) {
		// Source is depleted, start delivering early.
		creep.setRemoteHarvestState(false);
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
 * Makes the creep deliver remotely harvested resources.
 */
Creep.prototype.performRemoteHarvesterDeliver = function () {
	const creep = this;
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
			creep.setRemoteHarvestState(true);
			return;
		}
	}

	if (this.hasCachedPath()) {
		this.followCachedPath();
		if (this.hasArrived()) {
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
 * Puts this creep into or out of remote harvesting mode.
 *
 * @param {boolean} harvesting
 *   Whether or not the creep should be harvesting right now.
 */
Creep.prototype.setRemoteHarvestState = function (harvesting) {
	this.memory.harvesting = harvesting;

	const targetPosition = utilities.decodePosition(this.memory.storage);
	const harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[this.memory.source];
	if (harvesting) {
		roleRemoteHarvester.startTravelTimer(this);
	}
	else {
		// Check if there is a container near the source, and save it.
		const container = this.pos.findClosestByRange(FIND_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_CONTAINER,
		});
		if (container && this.pos.getRangeTo(container) <= 3) {
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
		const sourceFlag = {pos: utilities.decodePosition(this.memory.source)};
		utilities.precalculatePaths(room, sourceFlag.pos);
	}

	if (harvestMemory.cachedPath) {
		this.setCachedPath(harvestMemory.cachedPath.path, !harvesting, 1);
	}
};

/**
 * Makes a creep behave like a remote harvester.
 */
Creep.prototype.runRemoteHarvesterLogic = function () {
	if (!this.memory.harvesting && this.carry.energy === 0) {
		this.setRemoteHarvestState(true);
	}
	else if (this.memory.harvesting && this.carry.energy === this.carryCapacity) {
		this.setRemoteHarvestState(false);
	}

	if (this.memory.harvesting) {
		roleRemoteHarvester.stopTravelTimer(this);
		this.performRemoteHarvest();
		return;
	}

	this.performRemoteHarvesterDeliver();
};

// @todo Make travel timer functions reusable.
const roleRemoteHarvester = {

	startTravelTimer(creep) {
		if (!creep.memory.travelTimer) {
			creep.memory.travelTimer = {
				start: Game.time,
			};
		}
	},

	stopTravelTimer(creep) {
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
	},

};
