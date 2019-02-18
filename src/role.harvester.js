'use strict';

/* global Creep FIND_STRUCTURES STRUCTURE_LINK RESOURCE_ENERGY
STRUCTURE_CONTAINER FIND_CONSTRUCTION_SITES */

// @todo Rewrite delivery part using priority queue.
// @todo Just make the harvester build a container when none is available.

/**
 * Makes the creep gather resources in the current room.
 */
Creep.prototype.performHarvest = function () {
	const creep = this;
	let source;
	if (creep.memory.fixedSource) {
		source = Game.getObjectById(creep.memory.fixedSource);
		// @todo Just in case, handle source not existing anymore.
	}
	else if (creep.memory.fixedMineralSource) {
		source = Game.getObjectById(creep.memory.fixedMineralSource);
		// @todo Just in case, handle source not existing anymore, or missing extractor.
	}
	else {
		if (!creep.memory.resourceTarget) {
			if (!creep.room.sources || creep.room.sources.length <= 0) {
				return;
			}

			creep.memory.resourceTarget = creep.room.sources[Math.floor(Math.random() * creep.room.sources.length)].id;
			delete creep.memory.deliverTarget;
		}

		const best = creep.memory.resourceTarget;
		if (!best) {
			return;
		}

		source = Game.getObjectById(best);
		if (!source) {
			delete creep.memory.resourceTarget;
		}
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
 */
Creep.prototype.performMineralHarvesterDeliver = function () {
	const creep = this;
	const source = Game.getObjectById(creep.memory.fixedMineralSource);
	const container = source.getNearbyContainer();
	let target;
	// By default, deliver to room's terminal if there's space.
	if (container && _.sum(container.store) + creep.carryCapacity <= container.storeCapacity) {
		target = container;
	}
	else {
		target = this.room.getBestStorageTarget(this.carryCapacity, source.mineralType);
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
 */
Creep.prototype.performHarvesterDeliver = function () {
	if (this.memory.fixedMineralSource) {
		this.performMineralHarvesterDeliver();
		return;
	}

	if (!this.memory.fixedSource) return;

	const creep = this;
	const source = Game.getObjectById(creep.memory.fixedSource);
	const targetLink = source.getNearbyLink();
	const targetContainer = source.getNearbyContainer();
	let target;

	if (_.size(creep.room.creepsByRole.transporter) === 0) {
		// Use transporter drop off logic.
		this.performDeliver();
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
			this.buildTarget(sites[0]);
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

/**
 * Puts this creep into or out of harvesting mode.
 *
 * @param {boolean} harvesting
 *   Whether this creep should be harvesting.
 */
Creep.prototype.setHarvesterState = function (harvesting) {
	this.memory.harvesting = harvesting;
	delete this.memory.resourceTarget;
	delete this.memory.deliverTarget;
};

/**
 * Makes a creep behave like a harvester.
 */
Creep.prototype.runHarvesterLogic = function () {
	if (!this.memory.harvesting && _.sum(this.carry) <= 0) {
		this.setHarvesterState(true);
	}
	else if (this.memory.harvesting && _.sum(this.carry) >= this.carryCapacity) {
		this.setHarvesterState(false);
	}

	if (this.memory.harvesting) {
		this.performHarvest();
		return;
	}

	this.performHarvesterDeliver();
};
