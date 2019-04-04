'use strict';

/* global FIND_STRUCTURES STRUCTURE_LINK RESOURCE_ENERGY
STRUCTURE_CONTAINER FIND_CONSTRUCTION_SITES */

// @todo Rewrite delivery part using transporter logic.
// @todo Just make the harvester build a container when none is available.
// @todo Merge fixedMineralSource into fixedSource.

const Role = require('./role');

const HarvesterRole = function () {
	Role.call(this);

	// Harvesting energy is essential and doesn't need tons of CPU.
	this.stopAt = 0;
	this.throttleAt = 2000;
};

HarvesterRole.prototype = Object.create(Role.prototype);

/**
 * Makes a creep behave like a harvester.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
HarvesterRole.prototype.run = function (creep) {
	const carryAmount = _.sum(creep.carry);
	if (!creep.memory.harvesting && carryAmount <= 0) {
		this.setHarvesterState(creep, true);
	}
	else if (creep.memory.harvesting && carryAmount >= creep.carryCapacity) {
		this.setHarvesterState(creep, false);
	}

	if (creep.memory.harvesting) {
		this.performHarvest(creep);
		return;
	}

	this.performHarvesterDeliver(creep);
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

	if (creep.pos.getRangeTo(source) > 1) {
		creep.moveToRange(source, 1);
	}
	else {
		creep.harvest(source);
	}

	// If there's a link or controller nearby, directly deposit resources.
	if (_.sum(creep.carry) > creep.carryCapacity * 0.5) {
		let target = source.getNearbyContainer();
		if (creep.carry.energy > 0) {
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
	if (container && _.sum(container.store) + creep.carryCapacity <= container.storeCapacity) {
		target = container;
	}
	else {
		target = creep.room.getBestStorageTarget(creep.carryCapacity, source.mineralType);
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
		creep.performDeliver();
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
			if (creep.pos.getRangeTo(target) > 3) {
				creep.moveToRange(target, 3);
			}
			else {
				creep.build(target);
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
