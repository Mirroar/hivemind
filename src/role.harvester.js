// @todo Rewrite delivery part using priority queue.
// @todo Just make the harvester build a container when none is available.

var utilities = require('utilities');

/**
 * Makes the creep gather resources in the current room.
 */
Creep.prototype.performHarvest = function () {
	var creep = this;
	var source;
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
				return false;
			}

			creep.memory.resourceTarget = creep.room.sources[Math.floor(Math.random() * creep.room.sources.length)].id;
			creep.memory.deliverTarget = null;
		}
		var best = creep.memory.resourceTarget;
		if (!best) {
			return false;
		}
		source = Game.getObjectById(best);
		if (!source) {
			creep.memory.resourceTarget = null;
		}
	}

	if (creep.pos.getRangeTo(source) > 1) {
		creep.moveToRange(source, 1);
	}
	else {
		var result = creep.harvest(source);
	}

	// If there's a link or controller nearby, directly deposit resources.
	if (_.sum(creep.carry) > creep.carryCapacity * 0.5) {
		var target = source.getNearbyContainer();
		if (creep.carry.energy > 0) {
			let link = source.getNearbyLink();
			if (link && link.energy < link.energyCapacity) {
				target = link;
			}
			else {
				// Check for other nearby links.
				let links = source.pos.findInRange(FIND_STRUCTURES, 3, {filter: (structure) => structure.structureType == STRUCTURE_LINK && structure.energy < structure.energyCapacity});
				for (var i in links) {
					target = links[i];
					break;
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

	return true;
};

/**
 * Dumps minerals a harvester creep has gathered.
 */
Creep.prototype.performMineralHarvesterDeliver = function () {
	var creep = this;
	var source = Game.getObjectById(creep.memory.fixedMineralSource);
	var container = source.getNearbyContainer();
	var target;
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

	return true;
};

/**
 * Dumps resources a harvester creep has gathered.
 */
Creep.prototype.performHarvesterDeliver = function () {
	if (this.memory.fixedMineralSource) {
		return this.performMineralHarvesterDeliver();
	}

	var creep = this;
	var target;

	if (this.memory.fixedSource) {
		var source = Game.getObjectById(creep.memory.fixedSource);
		var targetLink = source.getNearbyLink();
		var targetContainer = source.getNearbyContainer();
		var dropOffSpot = source.getDropoffSpot();

		this.memory.fixedDropoffSpot = dropOffSpot;
		this.memory.fixedTarget = source.memory.targetContainer; // @todo this should not work well...
	}

	if (_.size(creep.room.creepsByRole.transporter) > 0) {
		// Drop off in link or container.
		if (targetLink && targetLink.energy < targetLink.energyCapacity && creep.room.getStoredEnergy() > 10000) {
			target = targetLink;
		}
		else if (targetContainer && _.sum(targetContainer.store) < targetContainer.storeCapacity) {
			target = targetContainer;
		}
		else if (dropOffSpot) {
			if (true || creep.pos.x == dropOffSpot.x && creep.pos.y == dropOffSpot.y) {
				creep.drop(RESOURCE_ENERGY);
			} else {
				creep.moveTo(dropOffSpot.x, dropOffSpot.y);
			}
			return true;
		}
	}

	if (!target) {
		// @todo Use transporter drop off logic.
		if (!creep.memory.deliverTarget) {
			var targets = creep.room.find(FIND_STRUCTURES, {
				filter: (structure) => {
					return (structure.structureType == STRUCTURE_EXTENSION ||
							structure.structureType == STRUCTURE_SPAWN ||
							structure.structureType == STRUCTURE_TOWER) && structure.energy < structure.energyCapacity;
				}
			});
			if (targets.length <= 0) {
				// Containers get filled when all other structures are full.
				targets = creep.room.find(FIND_STRUCTURES, {
					filter: (structure) => {
						return (structure.structureType == STRUCTURE_CONTAINER) && structure.storeCapacity && _.sum(structure.store) < structure.storeCapacity;
					}
				});
				if (targets.length <= 0) {
					return false;
				}
			}

			creep.memory.resourceTarget = null;
			creep.memory.deliverTarget = utilities.getClosest(creep, targets);
		}
		var best = creep.memory.deliverTarget;
		if (!best) {
			return false;
		}
		target = Game.getObjectById(best);
		if (!target) {
			creep.memory.deliverTarget = null;
			return false;
		}
	}

	if (source && !targetContainer && creep.pos.getRangeTo(source) <= 1) {
		// Check if there is a container construction site nearby and help build it.
		let sites = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 3, {
			filter: (site) => site.structureType == STRUCTURE_CONTAINER
		});

		if (sites.length > 0) {
			this.buildTarget(sites[0]);
			return true;
		}
	}

	if (creep.pos.getRangeTo(target) > 1) {
		creep.moveToRange(target, 1);
	}
	else {
		creep.transfer(target, RESOURCE_ENERGY);
	}

	if (target.energy >= target.energyCapacity) {
		creep.memory.deliverTarget = null;
	}
	if (target.store && _.sum(target.store) >= target.storeCapacity) {
		if (creep.memory.fixedTarget && target.id == creep.memory.fixedTarget) {
			// Container is full, drop energy instead.
			if (false && creep.memory.fixedDropoffSpot) {
				if (creep.pos.x == creep.memory.fixedDropoffSpot.x && creep.pos.y == creep.memory.fixedDropoffSpot.y) {
					creep.drop(RESOURCE_ENERGY);
				} else {
					creep.moveTo(creep.memory.fixedDropoffSpot.x, creep.memory.fixedDropoffSpot.y);
				}
			}
			else {
				// Drop on the spot, I guess.
				creep.drop(RESOURCE_ENERGY);
			}
		}
		else {
			creep.memory.deliverTarget = null;
		}
	}
	return true;
};

/**
 * Puts this creep into or out of harvesting mode.
 */
Creep.prototype.setHarvesterState = function (harvesting) {
	this.memory.harvesting = harvesting;
	delete this.memory.resourceTarget;
	delete this.memory.tempRole;
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
		return this.performHarvest();
	}
	else {
		return this.performHarvesterDeliver();
	}
};
