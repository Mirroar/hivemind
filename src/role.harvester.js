'use strict';

/* global FIND_STRUCTURES STRUCTURE_LINK RESOURCE_ENERGY
STRUCTURE_CONTAINER FIND_CONSTRUCTION_SITES */

// @todo Rewrite delivery part using transporter logic.
// @todo Just make the harvester build a container when none is available.
// @todo Merge fixedMineralSource into fixedSource.
// @todo Stop harvesting when container and link are full.

const Role = require('./role');
const TransporterRole = require('./role.transporter');
const utilities = require('./utilities');

const HarvesterRole = function () {
	Role.call(this);

	// Harvesting energy is essential and doesn't need tons of CPU.
	this.stopAt = 0;
	this.throttleAt = 2000;

	this.transporterRole = new TransporterRole();
};

HarvesterRole.prototype = Object.create(Role.prototype);

/**
 * Makes a creep behave like a harvester.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
HarvesterRole.prototype.run = function (creep) {
	this.transporterRole.creep = creep;

	const carryAmount = creep.store.getUsedCapacity();
	if (!creep.memory.harvesting && carryAmount <= 0) {
		this.setHarvesterState(creep, true);
	}
	else if (creep.memory.harvesting && carryAmount >= creep.store.getCapacity()) {
		// Have harvester explicitly deliver resources, unless it's a fixed energy
		// harvester with no need to move.
		if (creep.memory.fixedMineralSource || _.size(creep.room.creepsByRole.transporter) === 0) {
			this.setHarvesterState(creep, false);
		}
	}

	if (creep.memory.harvesting) {
		this.performHarvest(creep);
		return;
	}

	this.performHarvesterDeliver(creep);
};

/**
 * @todo
 */
HarvesterRole.prototype.determineHarvestPosition = function (creep, source) {
	if (creep.memory.harvestPos || creep.memory.noHarvestPos) return;

	const sourceMemory = creep.room.roomPlanner.memory.sources;
	if (sourceMemory && sourceMemory[source.id]) {
		creep.memory.harvestPos = sourceMemory[source.id].harvestPos;
	}

	if (!creep.memory.harvestPos) {
		creep.memory.noHarvestPos = true;
	}
};

/**
 * Puts this creep into or out of harvesting mode.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 * @param {boolean} harvesting
 *   Whether this creep should be harvesting.
 */
HarvesterRole.prototype.setHarvesterState = function (creep, harvesting) {
	creep.memory.harvesting = harvesting;
	delete creep.memory.resourceTarget;
	delete creep.memory.deliverTarget;
};

/**
 * Makes the creep gather resources in the current room.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
HarvesterRole.prototype.performHarvest = function (creep) {
	let source;
	if (creep.memory.fixedSource) {
		source = Game.getObjectById(creep.memory.fixedSource);
		// @todo Just in case, handle source not existing anymore.
	}
	else if (creep.memory.fixedMineralSource) {
		source = Game.getObjectById(creep.memory.fixedMineralSource);
		// @todo Just in case, handle source not existing anymore, or missing extractor.
	}

	this.determineHarvestPosition(creep, source);

	// By default, just move to range 1 of the source.
	let targetPos = source.pos;
	let targetRange = 1;

	// If available, move onto a harvest position.
	if (creep.memory.harvestPos) {
		const harvestPosition = utilities.deserializePosition(creep.memory.harvestPos, creep.room.name);
		if (harvestPosition.lookFor(LOOK_CREEPS).length === 0) {
			targetPos = harvestPosition;
			targetRange = 0;
		}
	}

	if (creep.pos.getRangeTo(targetPos) > targetRange) {
		creep.moveToRange(targetPos, targetRange);
		return;
	}

	creep.harvest(source);

	// If there's a harvester bay, transfer resources into it.
	if (this.depositInBay(creep)) return;

	// If there's a link or controller nearby, directly deposit resources.
	this.depositResources(creep, source);
};

/**
 *
 */
HarvesterRole.prototype.depositInBay = function (creep) {
	if (!creep.memory.harvestPos) return false ;
	const harvestPosition = utilities.deserializePosition(creep.memory.harvestPos, creep.room.name);
	const bay = _.find(creep.room.bays, bay => bay.name === utilities.encodePosition(harvestPosition));

	if (!bay) return false;
	if (creep.pos.x !== bay.pos.x || creep.pos.y !== bay.pos.y) return false;

	if (creep.store.getUsedCapacity() > creep.store.getCapacity() * (bay.needsRefill() ? 0.3 : 0.8)) bay.refillFrom(creep);
	if (bay.needsRefill()) this.pickupEnergy(creep);

	return true;
};

/**
 *
 */
HarvesterRole.prototype.pickupEnergy = function (creep) {
	const resources = creep.pos.lookFor(LOOK_RESOURCES);
	const energy = _.find(resources, r => r.resourceType === RESOURCE_ENERGY);
	if (energy) {
		creep.pickup(energy);
		return;
	}

	const structures = creep.pos.lookFor(LOOK_STRUCTURES);
	const container = _.find(structures, s => s.structureType === STRUCTURE_CONTAINER);
	if (container && (container.store.energy || 0) > 0) {
		creep.withdraw(container, RESOURCE_ENERGY);
	}
};

/**
 *
 */
HarvesterRole.prototype.depositResources = function (creep, source) {
	if (creep.store.getFreeCapacity() > creep.store.getCapacity() * 0.5) return;

	let target = source.getNearbyContainer();
	if (creep.store.energy > 0) {
		const link = source.getNearbyLink();
		if (link && link.energy < link.energyCapacity) {
			target = link;
		}
		else {
			// Check for other nearby links.
			const links = source.pos.findInRange(FIND_STRUCTURES, 3, {filter: structure => structure.structureType === STRUCTURE_LINK && structure.energy < structure.energyCapacity});
			if (links.length > 0) {
				target = links[0];
			}
		}
	}

	if (target) {
		if (creep.pos.getRangeTo(target) > 1) {
			creep.moveToRange(target, 1);
		}
		else {
			creep.transferAny(target);
		}
	}
};

/**
 * Dumps minerals a harvester creep has gathered.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
HarvesterRole.prototype.performMineralHarvesterDeliver = function (creep) {
	const source = Game.getObjectById(creep.memory.fixedMineralSource);
	const container = source.getNearbyContainer();
	let target;
	// By default, deliver to room's terminal if there's space.
	if (container && _.sum(container.store) + creep.store.getCapacity() <= container.storeCapacity) {
		target = container;
	}
	else {
		target = creep.room.getBestStorageTarget(creep.store.getCapacity(), source.mineralType);
	}

	if (target) {
		if (creep.pos.getRangeTo(target) > 1) {
			creep.moveToRange(target, 1);
		}
		else {
			creep.transferAny(target);
		}
	}
	else {
		// @todo Drop on storage point, I guess? We probably shouldn't be collecting minerals if we have no place to store them.
	}
};

/**
 * Dumps resources a harvester creep has gathered.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
HarvesterRole.prototype.performHarvesterDeliver = function (creep) {
	if (creep.memory.fixedMineralSource) {
		this.performMineralHarvesterDeliver(creep);
		return;
	}

	if (!creep.memory.fixedSource) return;

	const source = Game.getObjectById(creep.memory.fixedSource);
	const targetLink = source.getNearbyLink();
	const targetContainer = source.getNearbyContainer();
	let target;

	if (_.size(creep.room.creepsByRole.transporter) === 0) {
		// Use transporter drop off logic.
		this.transporterRole.performDeliver();
		return;
	}

	// Drop off in link or container.
	if (targetLink && targetLink.energy < targetLink.energyCapacity && creep.room.getStoredEnergy() > 10000) {
		target = targetLink;
	}
	else if (targetContainer && _.sum(targetContainer.store) < targetContainer.storeCapacity) {
		target = targetContainer;
	}
	else {
		creep.drop(RESOURCE_ENERGY);
		return;
	}

	if (source && !targetContainer && creep.pos.getRangeTo(source) <= 1) {
		// Check if there is a container construction site nearby and help build it.
		const sites = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 3, {
			filter: site => site.structureType === STRUCTURE_CONTAINER,
		});

		if (sites.length > 0) {
			if (creep.pos.getRangeTo(sites[0]) > 3) {
				creep.moveToRange(sites[0], 3);
			}
			else {
				creep.build(sites[0]);
			}

			return;
		}
	}

	if (creep.pos.getRangeTo(target) > 1) {
		creep.moveToRange(target, 1);
	}
	else {
		creep.transfer(target, RESOURCE_ENERGY);
	}

	if (target.store && _.sum(target.store) >= target.storeCapacity) {
		// Drop on the spot, I guess.
		creep.drop(RESOURCE_ENERGY);
	}
};

module.exports = HarvesterRole;
