/* global FIND_STRUCTURES FIND_MY_CONSTRUCTION_SITES STRUCTURE_SPAWN
STRUCTURE_RAMPART STRUCTURE_WALL STRUCTURE_ROAD STRUCTURE_CONTAINER */

import hivemind from './hivemind';
import Role from './role';
import TransporterRole from './role.transporter';
import utilities from './utilities';

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

export default class BuilderRole extends Role {
	transporterRole: TransporterRole;

	/**
	 * Builders stay in their spawn room and build or repair structures.
	 *
	 * When empty, they will gather energy from various sources. Once enough
	 * energy is carried, they will pick a target to build or repair, move to it,
	 * and use their energy for it.
	 * Targets are chosen by priority based on the structure type, missing
	 * hit points, etc.
	 * Energy may be spent on repairing nearby structures (mostly roads) on the
	 * move so less effort is needed to individually maintain these.
	 *
	 * @todo Document memory structure.
	 */
	constructor() {
		super();

		this.transporterRole = new TransporterRole();
	};

	/**
	 * Makes this creep behave like a builder.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep) {
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

		this.transporterRole.performGetEnergy(creep);
	}

	/**
	 * Puts this creep into or out of repair mode.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {boolean} repairing
	 *   Whether to start building / repairing or not.
	 */
	setBuilderState(creep, repairing) {
		creep.memory.repairing = repairing;
		delete creep.memory.order;
	}

	/**
	 * Makes the creep repair damaged buildings.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @return {boolean}
	 *   True if an action was performed.
	 */
	performRepair(creep) {
		if (!creep.memory.order || !creep.memory.order.target) {
			this.calculateBuilderTarget(creep);
		}

		if (!creep.memory.order || !creep.memory.order.target) {
			return false;
		}

		const target: Structure = Game.getObjectById(creep.memory.order.target);
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
	}

	/**
	 * Sets a good repair or build target for this creep.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	calculateBuilderTarget(creep) {
		delete creep.memory.order;

		const best = utilities.getBestOption(this.getAvailableBuilderTargets(creep));
		if (!best) return;

		creep.memory.order = {
			type: best.type,
			target: best.object.id,
			maxHealth: best.maxHealth,
		};
	}

	/**
	 * Collects information about all damaged or unfinished buildings in the current room.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @return {Array}
	 *   An array of repair or build option objects.
	 */
	getAvailableBuilderTargets(creep) {
		const options = [];

		this.addRepairOptions(creep, options);
		this.addBuildOptions(creep, options);

		return options;
	}

	/**
	 * Collects damaged structures with priorities for repairing.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {Array} options
	 *   An array of repair or build option objects to add to.
	 */
	addRepairOptions(creep, options) {
		const targets = creep.room.find(FIND_STRUCTURES, {
			filter: structure => structure.hits < structure.hitsMax && !structure.needsDismantling(),
		});
		for (const target of targets) {
			const option = {
				priority: 3,
				weight: 1 - (target.hits / target.hitsMax),
				type: 'repair',
				object: target,
				maxHealth: null,
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

			// Spread out repairs unless room is under attack.
			if (creep.room.defense.getEnemyStrength() === 0) {
				option.priority -= creep.room.getCreepsWithOrder('repair', target.id).length;
			}

			options.push(option);
		}
	}

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
	modifyRepairDefensesOption(creep, option, target) {
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

		if (target.structureType === STRUCTURE_RAMPART) {
			if (target.hits < 10000 && creep.room.controller.level >= 3) {
				// Low ramparts get special treatment so they don't decay.
				option.priority++;
				option.priority++;
				option.weight++;
			}
			else if (creep.room.getStoredEnergy() < 5000) {
				// Don't strengthen ramparts too much if room is struggling for energy.
				option.priority = -1;
			}
			if (target.hits < 3000000 && creep.room.controller.level >= 6) {
				// Once we have a terminal, get ramparts to a level where we can
				// comfortably defend the room.
				option.priority++;
			}
			else if (creep.room.defense.getEnemyStrength() > 1) {
				// Repair defenses as much as possible to keep invaders out.
				option.priority++;
				option.priority++;
				option.weight++;
			}
		}
	}

	/**
	 * Collects construction sites with priorities for building.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {Array} options
	 *   An array of repair or build option objects to add to.
	 */
	addBuildOptions(creep, options) {
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

			if (target.progressTotal < 1000) {
				// For things that are build quickly, don't send multiple builders to the
				// same target.
				// @todo Use target.progressTotal - target.progress in relation to
				// assigned builders' stored energy for this decision.
				option.priority -= creep.room.getCreepsWithOrder('build', target.id).length;
			}

			if (target.structureType === STRUCTURE_SPAWN) {
				// Spawns have highest construction priority - we want to make
				// sure moving a spawn always works out.
				option.priority = 5;
			}

			if ([STRUCTURE_LAB, STRUCTURE_NUKER].indexOf(target.structureType) !== -1) {
				// Expensive structures should only be built with excess energy.
				option.priority--;
			}

			options.push(option);
		}
	}

	/**
	 * Moves towards a target structure and repairs it once close enough.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {Structure} target
	 *   The structure to repair.
	 */
	repairTarget(creep, target) {
		if (creep.pos.getRangeTo(target) > 3) {
			creep.moveToRange(target, 3);

			// Also try to repair things that are close by when appropriate.
			this.repairNearby(creep);
		}
		else {
			creep.repair(target);
		}
	}

	/**
	 * Moves towards a target construction site and builds it once close enough.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {ConstructionSite} target
	 *   The construction site to build.
	 */
	buildTarget(creep, target) {
		if (creep.pos.getRangeTo(target) > 3) {
			creep.moveToRange(target, 3);

			// Also try to repair things that are close by when appropriate.
			this.repairNearby(creep);
		}
		else {
			creep.build(target);
		}
	}

	/**
	 * While not actively working on anything else, use carried energy to repair nearby structures.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	repairNearby(creep) {
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
	}
}
