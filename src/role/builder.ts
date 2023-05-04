/* global FIND_STRUCTURES FIND_MY_CONSTRUCTION_SITES STRUCTURE_SPAWN OK
STRUCTURE_RAMPART STRUCTURE_WALL STRUCTURE_ROAD STRUCTURE_CONTAINER WORK
UPGRADE_CONTROLLER_POWER RESOURCE_ENERGY */

import balancer from 'excess-energy-balancer';
import hivemind from 'hivemind';
import Role from 'role/role';
import TransporterRole from 'role/transporter';
import utilities from 'utilities';
import {throttle} from 'utils/throttle';

interface RepairOrder {
	type: 'repair';
	target: Id<Structure>;
	maxHealth: number;
}

interface BuildOrder {
	type: 'build';
	target: Id<ConstructionSite>;
}

declare global {
	interface BuilderCreep extends Creep {
		role: 'builder';
		memory: BuilderCreepMemory;
		heapMemory: BuilderCreepHeapMemory;
	}

	interface BuilderCreepMemory extends CreepMemory {
		role: 'builder';
		repairing?: boolean;
		order?: RepairOrder | BuildOrder;
	}

	interface BuilderCreepHeapMemory extends CreepHeapMemory {
	}

	interface RoomMemory {
		noBuilderNeeded?: number;
	}
}

// @todo Calculate from constants.
const wallHealth: Record<number, number> = hivemind.settings.get('maxWallHealth');

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
	}

	/**
	 * Makes this creep behave like a builder.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: BuilderCreep) {
		if (creep.heapMemory.suicideSpawn) {
			this.performRecycle(creep);
			return;
		}

		if ((creep.memory.repairing || creep.memory.upgrading) && creep.store[RESOURCE_ENERGY] === 0) {
			this.setBuilderState(creep, false);
		}
		else if (!creep.memory.repairing && !creep.memory.upgrading && creep.store.getUsedCapacity() >= creep.store.getCapacity() * 0.9) {
			this.setBuilderState(creep, true);
		}

		if (creep.memory.upgrading) {
			this.performUpgrade(creep);
			return;
		}

		if (creep.memory.repairing) {
			if (!this.performRepair(creep)) {
				if (creep.room.controller?.level < 8) {
					creep.memory.upgrading = true;
					delete creep.memory.repairing;
					this.performUpgrade(creep);
				}
				else {
					// Prevent draining energy stores by recycling.
					delete creep.memory.repairing;
					creep.room.memory.noBuilderNeeded = Game.time;
					this.performRecycle(creep);
				}
			}

			return;
		}

		if (creep.memory.sourceTarget && !creep.memory.order) {
			delete creep.memory.sourceTarget;
		}

		if (!creep.room.storage || creep.room.getEffectiveAvailableEnergy() > 2500) {
			const deliveringCreeps = creep.room.getCreepsWithOrder('workerCreep', creep.id);
			if (deliveringCreeps.length > 0) {
				creep.moveToRange(deliveringCreeps[0], 1);
				return;
			}

			// @todo Instead of completely circumventing TypeScript, find a way to
			// make energy gathering reusable between multiple roles.
			// @todo Replace with dispatcher calls similar to hauler creeps delivery
			// once all sources are covered by dispatcher.
			this.transporterRole.performGetEnergy(creep as unknown as TransporterCreep);
		}
	}

	/**
	 * Puts this creep into or out of repair mode.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {boolean} repairing
	 *   Whether to start building / repairing or not.
	 */
	setBuilderState(creep: BuilderCreep, repairing: boolean) {
		creep.memory.repairing = repairing;
		delete creep.memory.upgrading;
		delete creep.memory.sourceTarget;
		delete creep.memory.order;
	}

	performUpgrade(creep: BuilderCreep) {
		if (creep.room.roomManager?.hasMisplacedSpawn()) {
			delete creep.memory.upgrading;
			return;
		}

		if (!creep.room.storage || creep.room.getEffectiveAvailableEnergy() < 25_000 || (creep.room.controller.level === 8 && !balancer.maySpendEnergyOnGpl())) {
			// Prevent draining energy stores by recycling.
			creep.room.memory.noBuilderNeeded = Game.time;
			this.performRecycle(creep);
			return;
		}

		const controller = creep.room.controller;
		creep.whenInRange(3, controller, () => {
			const result = creep.upgradeController(controller);
			if (controller.level == 8 && result == OK) {
				const amount = Math.min(creep.store[RESOURCE_ENERGY], creep.getActiveBodyparts(WORK) * UPGRADE_CONTROLLER_POWER);
				balancer.recordGplEnergy(amount);
			}
		});
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
	performRepair(creep: BuilderCreep): boolean {
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
			const target = Game.getObjectById(creep.memory.order.target);
			let maxHealth = target.hitsMax;
			if (creep.memory.order.maxHealth) {
				maxHealth = creep.memory.order.maxHealth;

				// Repair ramparts past their maxHealth to counteract decaying.
				if (target.structureType === STRUCTURE_RAMPART) {
					maxHealth = Math.min(maxHealth + 10_000, target.hitsMax);
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
			const target = Game.getObjectById(creep.memory.order.target);
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
	calculateBuilderTarget(creep: BuilderCreep) {
		delete creep.memory.order;

		const best = utilities.getBestOption(this.getAvailableBuilderTargets(creep));
		if (!best || best.priority <= 0) return;

		delete creep.room.memory.noBuilderNeeded;
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
	getAvailableBuilderTargets(creep: BuilderCreep) {
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
	addRepairOptions(creep: BuilderCreep, options) {
		const targets = creep.room.find(FIND_STRUCTURES, {
			filter: structure => structure.hits < structure.hitsMax
				&& !structure.needsDismantling()
				&& this.isSafePosition(creep, structure.pos),
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
				if (target.structureType === STRUCTURE_ROAD) {
					if (creep.room.roomPlanner && !creep.room.roomPlanner.isPlannedLocation(target.pos, 'road')) {
						// Let old roads decay naturally.
						continue;
					}

					if (target.hits > target.hitsMax / 3) {
						option.priority = 0;
					}
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
	modifyRepairDefensesOption(creep: BuilderCreep, option, target: StructureWall | StructureRampart) {
		option.priority--;
		if (target.structureType === STRUCTURE_WALL) {
			option.priority--;
			if (creep.room.roomPlanner && !creep.room.roomPlanner.isPlannedLocation(target.pos, 'wall')) {
				option.priority = -1;
				return;
			}
		}
		else if (target.structureType === STRUCTURE_RAMPART) {
			if (creep.room.roomPlanner && !creep.room.roomPlanner.isPlannedLocation(target.pos, 'rampart')) {
				option.priority = -1;
				return;
			}
		}

		// Walls and ramparts get repaired up to a certain health level.
		let maxHealth = wallHealth[target.room.controller.level];
		if (creep.room.roomPlanner && creep.room.roomPlanner.isPlannedLocation(target.pos, 'wall.quad')) {
			maxHealth /= 10;
		}
		if (creep.room.roomPlanner && creep.room.roomPlanner.isPlannedLocation(target.pos, 'rampart.ramp')) {
			maxHealth /= 10;
		}
		if (creep.room.roomPlanner && creep.room.roomPlanner.isPlannedLocation(target.pos, 'wall.blocker')) {
			maxHealth = 10_000;
		}
		else if (target.hits >= maxHealth * 0.9 && target.hits < target.hitsMax) {
			// This has really low priority.
			option.priority = creep.room.controller.level < 8 ? -1 : 0;
			maxHealth = target.hitsMax;
		}

		option.weight = 1 - (target.hits / maxHealth);
		option.maxHealth = maxHealth;

		if (target.structureType === STRUCTURE_RAMPART) {
			if (creep.room.defense.getEnemyStrength() >= 2) {
				option.priority++;
				return;
			}

			if (target.hits < 10_000 && creep.room.controller.level >= 3) {
				// Low ramparts get special treatment so they don't decay.
				option.priority++;
				option.priority++;
				option.weight++;
			}
			else if (creep.room.getEffectiveAvailableEnergy() < 5000) {
				// Don't strengthen ramparts too much if room is struggling for energy.
				option.priority = -1;
			}

			if (target.hits < hivemind.settings.get('minWallIntegrity') && creep.room.controller.level >= 6 && creep.room.terminal) {
				// Once we have a terminal, get ramparts to a level where we can
				// comfortably defend the room.
				option.priority++;
			}
			else if (creep.room.defense.getEnemyStrength() > 1) {
				// Repair defenses as much as possible to keep invaders out.
				// @todo Prioritize low HP wall / close to invaders.
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
	addBuildOptions(creep: BuilderCreep, options) {
		const targets = creep.room.find(FIND_MY_CONSTRUCTION_SITES, {
			filter: site => this.isSafePosition(creep, site.pos),
		});
		for (const target of targets) {
			const option = {
				priority: 4,
				weight: target.progress / target.progressTotal,
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

			if (([STRUCTURE_ROAD, STRUCTURE_RAMPART, STRUCTURE_WALL] as string[]).includes(target.structureType)) {
				// Roads and defenses can be built after functional buildings are done.
				option.weight--;
			}

			if (([STRUCTURE_LAB, STRUCTURE_NUKER, STRUCTURE_FACTORY] as string[]).includes(target.structureType)) {
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
	repairTarget(creep: BuilderCreep, target: Structure) {
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
	buildTarget(creep: BuilderCreep, target: ConstructionSite) {
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
	repairNearby(creep: BuilderCreep) {
		if (creep.store[RESOURCE_ENERGY] < creep.store.getCapacity() * 0.7 && creep.store[RESOURCE_ENERGY] > creep.store.getCapacity() * 0.3) return;
		if (throttle(creep.heapMemory._tO)) return;

		const workParts = creep.getActiveBodyparts(WORK);
		if (!workParts) return;

		const needsRepair = creep.pos.findInRange(FIND_STRUCTURES, 3, {filter: structure => {
			if (structure.needsDismantling()) return false;

			if (structure.structureType === STRUCTURE_ROAD) {
				const isPlannedRoad = creep.room.roomPlanner && creep.room.roomPlanner.isPlannedLocation(structure.pos, STRUCTURE_ROAD);
				const isOperationRoad = creep.room.roomManager && creep.room.roomManager.isOperationRoadPosition(structure.pos);

				if (!isPlannedRoad && !isOperationRoad) return false;
			}

			return true;
		}});

		for (const structure of needsRepair) {
			let maxHealth = structure.hitsMax;
			if (structure.structureType === STRUCTURE_RAMPART || structure.structureType === STRUCTURE_WALL) {
				if (!creep.room.roomPlanner) continue;
				if (!creep.room.roomPlanner.isPlannedLocation(structure.pos, structure.structureType)) continue;

				maxHealth = wallHealth[structure.room.controller.level];
				if (creep.room.roomPlanner.isPlannedLocation(structure.pos, 'wall.blocker')) {
					maxHealth = 10_000;
				}
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
