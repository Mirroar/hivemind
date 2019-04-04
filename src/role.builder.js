'use strict';

/* global hivemind Creep FIND_STRUCTURES FIND_MY_CONSTRUCTION_SITES
STRUCTURE_RAMPART STRUCTURE_WALL STRUCTURE_ROAD STRUCTURE_CONTAINER
STRUCTURE_SPAWN */

const utilities = require('./utilities');
const Role = require('./role');

const BuilderRole = function () {
	Role.call(this);
};

BuilderRole.prototype = Object.create(Role.prototype);

// @todo Calculate from constants.
const wallHealth = {
	0: 1,
	1: 5000,
	2: 30000,
	3: 100000,
	4: 300000,
	5: 1000000,
	6: 2000000,
	7: 5000000,
	8: 300000000,
};

/**
 * Makes this creep behave like a builder.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
BuilderRole.prototype.run = function (creep) {
	if (creep.memory.repairing && creep.carry.energy === 0) {
		this.setBuilderState(creep, false);
	}
	else if (!creep.memory.repairing && _.sum(creep.carry) >= creep.carryCapacity * 0.9) {
		this.setBuilderState(creep, true);
	}

	if (creep.memory.repairing) {
		this.performRepair(creep);
		return;
	}

	creep.performGetEnergy();
};

/**
 * Puts this creep into or out of repair mode.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 * @param {boolean} repairing
 *   Whether to start building / repairing or not.
 */
BuilderRole.prototype.setBuilderState = function (creep, repairing) {
	creep.memory.repairing = repairing;
	delete creep.memory.order;
};

/**
 * Makes the creep repair damaged buildings.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 *
 * @return {boolean}
 *   True if an action was performed.
 */
BuilderRole.prototype.performRepair = function (creep) {
	if (!creep.memory.order || !creep.memory.order.target) {
		this.calculateBuilderTarget(creep);
	}

	if (!creep.memory.order || !creep.memory.order.target) {
		return false;
	}

	const target = Game.getObjectById(creep.memory.order.target);
	if (!target) {
		this.calculateBuilderTarget(creep);
		return true;
	}

	if (creep.memory.order.type === 'repair') {
		let maxHealth = target.hitsMax;
		if (creep.memory.order.maxHealth) {
			maxHealth = creep.memory.order.maxHealth;

			// Repair ramparts past their maxHealth to counteract decaying.
			if (target.structureType === STRUCTURE_RAMPART) {
				maxHealth = Math.min(maxHealth + 10000, target.hitsMax);
			}
		}

		if (!target.hits || target.hits >= maxHealth) {
			this.calculateBuilderTarget(creep);
			return true;
		}

		this.repairTarget(creep, target);
		return true;
	}

	if (creep.memory.order.type === 'build') {
		this.buildTarget(creep, target);
		return true;
	}

	// Unknown order type, recalculate!
	hivemind.log('creeps', creep.pos.roomName).info('Unknown order type detected on', creep.name);
	this.calculateBuilderTarget(creep);
	return true;
};

/**
 * Sets a good repair or build target for this creep.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
BuilderRole.prototype.calculateBuilderTarget = function (creep) {
	delete creep.memory.order;

	const best = utilities.getBestOption(this.getAvailableBuilderTargets(creep));
	if (!best) return;

	creep.memory.order = {
		type: best.type,
		target: best.object.id,
		maxHealth: best.maxHealth,
	};
};

/**
 * Collects information about all damaged or unfinished buildings in the current room.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 *
 * @return {Array}
 *   An array of repair or build option objects.
 */
BuilderRole.prototype.getAvailableBuilderTargets = function (creep) {
	const options = [];

	this.addRepairOptions(creep, options);
	this.addBuildOptions(creep, options);

	return options;
};

/**
 * Collects damaged structures with priorities for repairing.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 * @param {Array} options
 *   An array of repair or build option objects to add to.
 */
BuilderRole.prototype.addRepairOptions = function (creep, options) {
	const targets = creep.room.find(FIND_STRUCTURES, {
		filter: structure => structure.hits < structure.hitsMax && !structure.needsDismantling(),
	});
	for (const target of targets) {
		const option = {
			priority: 3,
			weight: 1 - (target.hits / target.hitsMax),
			type: 'repair',
			object: target,
		};

		if (target.structureType === STRUCTURE_WALL || target.structureType === STRUCTURE_RAMPART) {
			this.modifyRepairDefensesOption(creep, option, target);
		}
		else {
			if (target.hits / target.hitsMax > 0.9) {
				option.priority--;
			}

			if (target.hits / target.hitsMax < 0.2) {
				option.priority++;
			}

			// Roads are not that important, repair only when low.
			if (target.structureType === STRUCTURE_ROAD && target.hits > 1000) {
				option.priority--;
			}

			// Slightly adjust weight so that closer structures get prioritized. Not for walls or Ramparts, though, we want those to be equally strong all arond.
			option.weight -= creep.pos.getRangeTo(target) / 100;
		}

		// For many decaying structures, we don't care if they're "almost" full.
		if (target.structureType === STRUCTURE_ROAD || target.structureType === STRUCTURE_RAMPART || target.structureType === STRUCTURE_CONTAINER) {
			if (target.hits / (option.maxHealth || target.hitsMax) > 0.9) {
				continue;
			}
		}

		if (target.hits >= (option.maxHealth || target.hitsMax)) continue;

		option.priority -= creep.room.getCreepsWithOrder('repair', target.id).length;

		options.push(option);
	}
};

/**
 * Modifies basic repair order for defense structures.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 * @param {object} option
 *   The repair order to modify.
 * @param {Structure} target
 *   The defensive structure in question.
 */
BuilderRole.prototype.modifyRepairDefensesOption = function (creep, option, target) {
	option.priority--;
	if (target.structureType === STRUCTURE_WALL) {
		option.priority--;
	}

	// Walls and ramparts get repaired up to a certain health level.
	let maxHealth = wallHealth[target.room.controller.level];
	if (creep.room.roomPlanner && creep.room.roomPlanner.isPlannedLocation(target.pos, 'wall.blocker')) {
		maxHealth = 10000;
	}
	else if (target.hits >= maxHealth * 0.9 && target.hits < target.hitsMax) {
		// This has really low priority.
		option.priority = 0;
		maxHealth = target.hitsMax;
	}

	option.weight = 1 - (target.hits / maxHealth);
	option.maxHealth = maxHealth;

	if (target.structureType === STRUCTURE_RAMPART && target.hits < 10000 && creep.room.controller.level >= 4) {
		// Low ramparts get special treatment so they don't decay.
		option.priority++;
		option.weight++;
	}
};

/**
 * Collects construction sites with priorities for building.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 * @param {Array} options
 *   An array of repair or build option objects to add to.
 */
BuilderRole.prototype.addBuildOptions = function (creep, options) {
	const targets = creep.room.find(FIND_MY_CONSTRUCTION_SITES);
	for (const target of targets) {
		const option = {
			priority: 4,
			weight: 1,
			type: 'build',
			object: target,
		};

		// Slightly adjust weight so that closer sites get prioritized.
		option.weight -= creep.pos.getRangeTo(target) / 100;

		option.priority -= creep.room.getCreepsWithOrder('build', target.id).length;

		if (target.structureType === STRUCTURE_SPAWN) {
			// Spawns have highest construction priority - we want to make
			// sure moving a spawn always works out.
			option.priority = 5;
		}

		options.push(option);
	}
};

/**
 * Moves towards a target structure and repairs it once close enough.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 * @param {Structure} target
 *   The structure to repair.
 */
BuilderRole.prototype.repairTarget = function (creep, target) {
	if (creep.pos.getRangeTo(target) > 3) {
		creep.moveToRange(target, 3);

		// Also try to repair things that are close by when appropriate.
		this.repairNearby(creep);
	}
	else {
		creep.repair(target);
	}
};

/**
 * Moves towards a target construction site and builds it once close enough.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 * @param {ConstructionSite} target
 *   The construction site to build.
 */
BuilderRole.prototype.buildTarget = function (creep, target) {
	if (creep.pos.getRangeTo(target) > 3) {
		creep.moveToRange(target, 3);

		// Also try to repair things that are close by when appropriate.
		this.repairNearby(creep);
	}
	else {
		creep.build(target);
	}
};

/**
 * While not actively working on anything else, use carried energy to repair nearby structures.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
BuilderRole.prototype.repairNearby = function (creep) {
	if (creep.carry.energy < creep.carryCapacity * 0.7 && creep.carry.energy > creep.carryCapacity * 0.3) return;
	if (utilities.throttle(creep.memory._tO)) return;

	const workParts = creep.memory.body.work;
	if (!workParts) return;

	const needsRepair = creep.room.find(FIND_STRUCTURES);
	for (const structure of needsRepair) {
		if (creep.pos.getRangeTo(structure) > 3) continue;
		if (structure.needsDismantling()) continue;

		let maxHealth = structure.hitsMax;
		if (structure.structureType === STRUCTURE_RAMPART || structure.structureType === STRUCTURE_WALL) {
			maxHealth = wallHealth[structure.room.controller.level];
		}

		if (structure.hits <= maxHealth - (workParts * 100)) {
			if (needsRepair.length > 0) {
				creep.repair(needsRepair[0]);
			}

			return;
		}
	}
};

module.exports = BuilderRole;
