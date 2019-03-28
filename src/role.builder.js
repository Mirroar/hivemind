'use strict';

/* global hivemind Creep FIND_STRUCTURES FIND_MY_CONSTRUCTION_SITES
STRUCTURE_RAMPART STRUCTURE_WALL STRUCTURE_ROAD STRUCTURE_CONTAINER
STRUCTURE_SPAWN */

const utilities = require('./utilities');

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
 * Collects information about all damaged or unfinished buildings in the current room.
 *
 * @return {Array}
 *   An array of repair or build option objects.
 */
Creep.prototype.getAvailableBuilderTargets = function () {
	const options = [];

	this.addRepairOptions(options);
	this.addBuildOptions(options);

	return options;
};

/**
 * Collects damaged structures with priorities for repairing.
 *
 * @param {Array} options
 *   An array of repair or build option objects to add to.
 */
Creep.prototype.addRepairOptions = function (options) {
	const targets = this.room.find(FIND_STRUCTURES, {
		filter: structure => structure.hits < structure.hitsMax && !structure.needsDismantling(),
	});
	for (const target of targets) {
		const option = {
			priority: 3,
			weight: 1 - (target.hits / target.hitsMax),
			type: 'structure',
			object: target,
		};

		if (target.structureType === STRUCTURE_WALL || target.structureType === STRUCTURE_RAMPART) {
			this.modifyRepairDefensesOption(option, target);
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
			option.weight -= this.pos.getRangeTo(target) / 100;
		}

		// For many decaying structures, we don't care if they're "almost" full.
		if (target.structureType === STRUCTURE_ROAD || target.structureType === STRUCTURE_RAMPART || target.structureType === STRUCTURE_CONTAINER) {
			if (target.hits / (option.maxHealth || target.hitsMax) > 0.9) {
				continue;
			}
		}

		option.priority -= this.room.getCreepsWithOrder('repair', target.id).length;

		options.push(option);
	}
};

/**
 * Modifies basic repair order for defense structures.
 *
 * @param {object} option
 *   The repair order to modify.
 * @param {Structure} target
 *   The defensive structure in question.
 */
Creep.prototype.modifyRepairDefensesOption = function (option, target) {
	option.priority--;
	if (target.structureType === STRUCTURE_WALL) {
		option.priority--;
	}

	// Walls and ramparts get repaired up to a certain health level.
	let maxHealth = wallHealth[target.room.controller.level];
	if (this.room.roomPlanner && this.room.roomPlanner.isPlannedLocation(target.pos, 'wall.blocker')) {
		maxHealth = 10000;
	}

	if (target.hits >= maxHealth * 0.9 && target.hits < target.hitsMax) {
		// This has really low priority.
		option.priority = 0;
		maxHealth = target.hitsMax;
	}

	option.weight = 1 - (target.hits / maxHealth);
	option.maxHealth = maxHealth;

	if (target.structureType === STRUCTURE_RAMPART && target.hits < 10000 && this.room.controller.level >= 4) {
		// Low ramparts get special treatment so they don't decay.
		option.priority++;
		option.weight++;
	}
};

/**
 * Collects construction sites with priorities for building.
 *
 * @param {Array} options
 *   An array of repair or build option objects to add to.
 */
Creep.prototype.addBuildOptions = function (options) {
	const targets = this.room.find(FIND_MY_CONSTRUCTION_SITES);
	for (const target of targets) {
		const option = {
			priority: 4,
			weight: 1,
			type: 'site',
			object: target,
		};

		// Slightly adjust weight so that closer sites get prioritized.
		option.weight -= this.pos.getRangeTo(target) / 100;

		option.priority -= this.room.getCreepsWithOrder('build', target.id).length;

		if (target.structureType === STRUCTURE_SPAWN) {
			// Spawns have highest construction priority - we want to make
			// sure moving a spawn always works out.
			option.priority = 5;
		}

		options.push(option);
	}
};

/**
 * Sets a good repair or build target for this creep.
 */
Creep.prototype.calculateBuilderTarget = function () {
	const creep = this;
	const best = utilities.getBestOption(creep.getAvailableBuilderTargets());

	if (best) {
		if (best.type === 'structure') {
			creep.memory.order = {
				type: 'repair',
				target: best.object.id,
				maxHealth: best.maxHealth,
			};
		}
		else if (best.type === 'site') {
			creep.memory.order = {
				type: 'build',
				target: best.object.id,
			};
		}
	}
	else {
		delete creep.memory.order;
	}
};

/**
 * Makes the creep repair damaged buildings.
 *
 * @return {boolean}
 *   True if an action was performed.
 */
Creep.prototype.performRepair = function () {
	const creep = this;
	if (!creep.memory.order || !creep.memory.order.target) {
		creep.calculateBuilderTarget();
	}

	if (!creep.memory.order || !creep.memory.order.target) {
		return false;
	}

	const target = Game.getObjectById(creep.memory.order.target);
	if (!target) {
		creep.calculateBuilderTarget();
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
			creep.calculateBuilderTarget();
			return true;
		}

		creep.repairTarget(target);
		return true;
	}

	if (creep.memory.order.type === 'build') {
		this.buildTarget(target);
		return true;
	}

	// Unknown order type, recalculate!
	hivemind.log('creeps', this.pos.roomName).info('Unknown order type detected on', creep.name);
	creep.calculateBuilderTarget();
	return true;
};

/**
 * Moves towards a target structure and repairs it once close enough.
 *
 * @param {Structure} target
 *   The structure to repair.
 */
Creep.prototype.repairTarget = function (target) {
	if (this.pos.getRangeTo(target) > 3) {
		this.moveToRange(target, 3);

		// Also try to repair things that are close by when appropriate.
		if ((this.carry.energy > this.carryCapacity * 0.7 || this.carry.energy < this.carryCapacity * 0.3) && !utilities.throttle(this.memory.throttleOffset)) {
			this.repairNearby();
		}
	}
	else {
		this.repair(target);
	}
};

/**
 * Moves towards a target construction site and builds it once close enough.
 *
 * @param {ConstructionSite} target
 *   The construction site to build.
 */
Creep.prototype.buildTarget = function (target) {
	if (this.pos.getRangeTo(target) > 3) {
		this.moveToRange(target, 3);

		// Also try to repair things that are close by when appropriate.
		if ((this.carry.energy > this.carryCapacity * 0.7 || this.carry.energy < this.carryCapacity * 0.3) && !utilities.throttle(this.memory.throttleOffset)) {
			this.repairNearby();
		}
	}
	else {
		this.build(target);
	}
};

/**
 * While not actively working on anything else, use carried energy to repair nearby structures.
 */
Creep.prototype.repairNearby = function () {
	const workParts = this.memory.body.work;
	if (!workParts) return;

	const needsRepair = this.room.find(FIND_STRUCTURES);
	for (const structure of needsRepair) {
		if (this.pos.getRangeTo(structure) > 3) continue;
		if (structure.needsDismantling()) continue;

		let maxHealth = structure.hitsMax;
		if (structure.structureType === STRUCTURE_RAMPART || structure.structureType === STRUCTURE_WALL) {
			maxHealth = wallHealth[structure.room.controller.level];
		}

		if (structure.hits <= maxHealth - (workParts * 100)) {
			if (needsRepair.length > 0) {
				this.repair(needsRepair[0]);
			}

			return;
		}
	}
};

/**
 * Puts this creep into or out of repair mode.
 *
 * @param {boolean} repairing
 *   Whether to start building / repairing or not.
 */
Creep.prototype.setBuilderState = function (repairing) {
	this.memory.repairing = repairing;
	delete this.memory.order;
};

/**
 * Makes this creep behave like a builder.
 */
Creep.prototype.runBuilderLogic = function () {
	if (this.memory.repairing && this.carry.energy === 0) {
		this.setBuilderState(false);
	}
	else if (!this.memory.repairing && _.sum(this.carry) >= this.carryCapacity * 0.9) {
		this.setBuilderState(true);
	}

	if (this.memory.repairing) {
		this.performRepair();
		return;
	}

	this.performGetEnergy();
};
