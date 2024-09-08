/* global FIND_STRUCTURES FIND_MY_CONSTRUCTION_SITES STRUCTURE_SPAWN OK
STRUCTURE_RAMPART STRUCTURE_WALL STRUCTURE_ROAD STRUCTURE_CONTAINER WORK
UPGRADE_CONTROLLER_POWER RESOURCE_ENERGY */

import balancer from 'excess-energy-balancer';
import cache from 'utils/cache';
import container from 'utils/container';
import hivemind from 'hivemind';
import Role from 'role/role';
import TransporterRole from 'role/transporter';
import utilities from 'utilities';
import {throttle} from 'utils/throttle';
import {ENEMY_STRENGTH_NONE, ENEMY_STRENGTH_NORMAL} from 'room-defense';
import {getResourcesIn} from 'utils/store';

interface RepairOrder {
	type: 'repair';
	target: Id<Structure>;
	maxHealth: number;
}

interface BuildOrder {
	type: 'build';
	target: Id<ConstructionSite>;
}

interface OrderOption {
	priority: number;
	weight: number;
	type: 'build' | 'repair';
	object: Structure<BuildableStructureConstant>;
	maxHealth?: number;
}

declare global {
	interface BuilderCreep extends Creep {
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

		this.dumpResources(creep);

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
			if (
				!this.performRepair(creep)
				&& (creep.room.defense.getEnemyStrength() < ENEMY_STRENGTH_NORMAL || creep.room.controller?.safeMode)
			) {
				creep.room.memory.noBuilderNeeded = Game.time;
				const funnelManager = container.get('FunnelManager');
				const isFunnelingElsewhere = creep.room.terminal && funnelManager.isFunneling() && !funnelManager.isFunnelingTo(creep.room.name) && creep.room.getEffectiveAvailableEnergy() < 100_000;
				const isStripmine = creep.room.controller.level >= 6 && creep.room.isStripmine();
				if (creep.room.controller?.level < 8 && !isFunnelingElsewhere && !isStripmine && !creep.room.controller.upgradeBlocked) {
					creep.memory.upgrading = true;
					delete creep.memory.repairing;
					this.performUpgrade(creep);
				}
				else if (!creep.room.roomManager?.hasMisplacedSpawn()) {
					// Prevent draining energy stores or CPU by recycling.
					delete creep.memory.repairing;
					this.performRecycle(creep);
				}
			}

			return;
		}

		if (creep.memory.sourceTarget && !creep.memory.order) {
			delete creep.memory.sourceTarget;
		}

		const deliveringCreeps = creep.room.getCreepsWithOrder('workerCreep', creep.id);
		if (deliveringCreeps.length > 0) {
			creep.moveToRange(deliveringCreeps[0], 1);
			return;
		}

		if (!creep.room.storage || creep.room.getEffectiveAvailableEnergy() > 2500) {
			// @todo Instead of completely circumventing TypeScript, find a way to
			// make energy gathering reusable between multiple roles.
			// @todo Replace with dispatcher calls similar to hauler creeps delivery
			// once all sources are covered by dispatcher.
			this.transporterRole.performGetEnergy(creep as unknown as TransporterCreep);
		}
	}

	dumpResources(creep: BuilderCreep) {
		if (creep.store.getUsedCapacity() === creep.store.getUsedCapacity(RESOURCE_ENERGY)) return;

		for (const resourceType of getResourcesIn(creep.store)) {
			if (resourceType === RESOURCE_ENERGY) continue;

			if (creep.drop(resourceType) === OK) return;
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
		if (
			creep.room.roomManager?.hasMisplacedSpawn()
			|| (creep.room.defense.getEnemyStrength() >= ENEMY_STRENGTH_NORMAL && !creep.room.controller?.safeMode)
			|| creep.room.find(FIND_MY_CONSTRUCTION_SITES).length > 0
		) {
			delete creep.memory.upgrading;
			delete creep.room.memory.noBuilderNeeded;
			return;
		}

		creep.room.memory.noBuilderNeeded = Game.time;
		const roomHasTooLittleEnergy = creep.room.storage && creep.room.getEffectiveAvailableEnergy() < 25_000;
		const shouldNotUpgrade = creep.room.controller.level === 8 && !balancer.maySpendEnergyOnGpl();
		const funnelManager = container.get('FunnelManager');
		const isFunnelingElsewhere = creep.room.terminal && funnelManager.isFunneling() && !funnelManager.isFunnelingTo(creep.room.name) && creep.room.getEffectiveAvailableEnergy() < 100_000;
		const isStripmine = creep.room.controller.level >= 6 && creep.room.isStripmine();
		if (
			roomHasTooLittleEnergy
			|| shouldNotUpgrade
			|| isFunnelingElsewhere
			|| isStripmine
			|| creep.room.controller.upgradeBlocked
		) {
			// Prevent draining energy stores by recycling.
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
		if (!creep.memory.order || !creep.memory.order.target || !Game.getObjectById(creep.memory.order.target)) {
			this.calculateBuilderTarget(creep);
		}

		if (!creep.memory.order || !creep.memory.order.target || !Game.getObjectById(creep.memory.order.target)) {
			return false;
		}

		if (
			creep.room.defense.getEnemyStrength() > ENEMY_STRENGTH_NORMAL
			&& !creep.room.controller?.safeMode
			&& !([STRUCTURE_SPAWN, STRUCTURE_RAMPART, STRUCTURE_TOWER, STRUCTURE_WALL] as string[]).includes(Game.getObjectById(creep.memory.order.target).structureType)
		) {
			this.calculateBuilderTarget(creep);

			if (!creep.memory.order || !creep.memory.order.target || !Game.getObjectById(creep.memory.order.target)) {
				return false;
			}
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
		hivemind.log('creeps', creep.pos.roomName).notify('Unknown order type detected on', creep.name);
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

		const best: any = utilities.getBestOption(this.getAvailableBuilderTargets(creep));
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
	getAvailableBuilderTargets(creep: BuilderCreep): OrderOption[] {
		const options: OrderOption[] = [];

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
	addRepairOptions(creep: BuilderCreep, options: OrderOption[]) {
		const targets = _.filter(
			this.getAvailableRepairTargets(creep),
			structure => structure.hits < structure.hitsMax
				&& !structure.needsDismantling()
				&& this.isSafePosition(creep, structure.pos),
		);
		for (const target of targets) {
			const option: OrderOption = {
				priority: 3,
				weight: 1 - (target.hits / target.hitsMax),
				type: 'repair',
				object: target,
				maxHealth: null,
			};

			if (target.structureType === STRUCTURE_WALL || target.structureType === STRUCTURE_RAMPART) {
				this.modifyRepairDefensesOption(creep, option, target as (StructureWall | StructureRampart));
			}
			else {
				if (target.hits / target.hitsMax > 0.9) {
					option.priority--;
				}

				if (target.hits / target.hitsMax < 0.2) {
					option.priority++;
				}

				// Roads are not that important, repair only when low.
				if (target.structureType === STRUCTURE_ROAD && target.hits > target.hitsMax / 3) {
					option.priority = 0;
				}

				// Slightly adjust weight so that closer structures get
				// prioritized. Not for walls or Ramparts, though, we want those
				// to be equally strong all arond.
				option.weight -= creep.pos.getRangeTo(target) / 100;
			}

			// For many decaying structures, we don't care if they're "almost" full.
			if ((target.structureType === STRUCTURE_ROAD || target.structureType === STRUCTURE_RAMPART || target.structureType === STRUCTURE_CONTAINER) && target.hits / (option.maxHealth || target.hitsMax) > 0.9) {
				continue;
			}

			// Spread out repairs unless room is under attack.
			if (creep.room.defense.getEnemyStrength() === ENEMY_STRENGTH_NONE) {
				option.priority -= creep.room.getCreepsWithOrder('repair', target.id).length;
			}

			options.push(option);
		}
	}

	getAvailableRepairTargets(creep: BuilderCreep): Array<Structure<BuildableStructureConstant>> {
		const repairableStructureIds = cache.inHeap('repairStructures:' + creep.room.name, 50, () => {
			const repairableStructures = _.filter(creep.room.structures, (structure: Structure<BuildableStructureConstant>) => {
				if (structure.hits >= this.getStructureMaxHits(structure)) return false;
				if (structure.needsDismantling()) return false;

				if (structure.structureType === STRUCTURE_ROAD) {
					const isPlannedRoad = creep.room.roomPlanner && creep.room.roomPlanner.isPlannedLocation(structure.pos, STRUCTURE_ROAD);
					const isOperationRoad = creep.room.roomManager && creep.room.roomManager.isOperationRoadPosition(structure.pos);

					// Let old roads decay naturally.
					if (!isPlannedRoad && !isOperationRoad) return false;
				}

				if (
					structure.structureType === STRUCTURE_RAMPART
					&& creep.room.roomPlanner
					&& !creep.room.roomPlanner.isPlannedLocation(structure.pos, 'rampart')
				) {
					// Let old ramparts decay naturally.
					return false;
				}

				if (
					structure.structureType === STRUCTURE_WALL
					&& creep.room.roomPlanner
					&& !creep.room.roomPlanner.isPlannedLocation(structure.pos, 'wall')
				) {
					// Ignore old walls.
					return false;
				}

				return true;
			});

			return _.map(
				repairableStructures,
				structure => structure.id,
			) as Array<Id<Structure<BuildableStructureConstant>>>;
		});

		return cache.inObject(creep.room, 'repairStructures', 1, () => _.filter(_.map(repairableStructureIds, (id: Id<Structure<BuildableStructureConstant>>) => Game.getObjectById(id))));
	}

	getStructureMaxHits(structure: Structure<BuildableStructureConstant>): number {
		if (structure.structureType === STRUCTURE_WALL || structure.structureType === STRUCTURE_RAMPART) {
			// @todo Have a defcon system that determines how high ramparts
			// should be at any given time.
			let maxHealth = wallHealth[structure.room.controller.level];
			if (
				structure.structureType === STRUCTURE_WALL
				&& structure.room.roomPlanner
				&& structure.room.roomPlanner.isPlannedLocation(structure.pos, 'wall.quad')
			) {
				maxHealth /= 10;
			}

			if (
				structure.structureType === STRUCTURE_RAMPART
				&& structure.room.roomPlanner
				&& structure.room.roomPlanner.isPlannedLocation(structure.pos, 'rampart.ramp')
			) {
				maxHealth /= 10;
			}

			if (
				structure.structureType === STRUCTURE_WALL
				&& structure.room.roomPlanner
				&& (structure.room.roomPlanner.isPlannedLocation(structure.pos, 'wall.blocker')
				|| structure.room.roomPlanner.isPlannedLocation(structure.pos, 'wall.deco'))
			) {
				maxHealth = 10_000;
			}

			return maxHealth;
		}

		return structure.hitsMax;
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
		if (target.structureType === STRUCTURE_WALL) option.priority--;

		// Walls and ramparts get repaired up to a certain health level.
		let maxHealth = this.getStructureMaxHits(target);

		if (
			(!creep.room.roomPlanner
			|| (!creep.room.roomPlanner.isPlannedLocation(target.pos, 'wall.blocker')
			&& !creep.room.roomPlanner.isPlannedLocation(target.pos, 'wall.deco')))
			&& target.hits >= maxHealth * 0.9 && target.hits < target.hitsMax
		) {
			// This has really low priority.
			option.priority = creep.room.controller.level < 8 ? -1 : 0;
			maxHealth = target.hitsMax;
		}

		option.weight = 1 - (target.hits / maxHealth);
		option.maxHealth = maxHealth;

		if (target.structureType === STRUCTURE_RAMPART) {
			if (target.hits < 10_000 && creep.room.controller.level >= 3) {
				// Low ramparts get special treatment so they don't decay.
				option.priority++;
				option.priority++;
				option.weight++;
			}

			if (creep.room.defense.getEnemyStrength() >= ENEMY_STRENGTH_NORMAL) {
				// Repair defenses as much as possible to keep invaders out.
				// @todo Prioritize low HP wall / close to invaders.
				option.priority++;
				option.priority++;
				option.weight++;
			}
			else if (creep.room.getEffectiveAvailableEnergy() < 5000 && target.hits >= 10_000) {
				// Don't strengthen ramparts too much if room is struggling for energy.
				option.priority = -1;
			}
			else if (target.hits < hivemind.settings.get('minWallIntegrity') && creep.room.controller.level >= 6 && creep.room.terminal) {
				// Once we have a terminal, get ramparts to a level where we can
				// comfortably defend the room.
				option.priority++;
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

			if (([STRUCTURE_ROAD, STRUCTURE_RAMPART, STRUCTURE_WALL, STRUCTURE_CONTAINER] as string[]).includes(target.structureType)) {
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
		creep.whenInRange(3, target, () => {
			creep.repair(target);
		});

		if (creep.pos.getRangeTo(target) > 3) {
			// Also try to repair things that are close by when appropriate.
			this.repairNearby(creep);
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
		creep.whenInRange(3, target, () => {
			creep.build(target);
		});

		if (creep.pos.getRangeTo(target) > 3) {
			// Also try to repair things that are close by when appropriate.
			this.repairNearby(creep);
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

		const needsRepair = _.filter(this.getAvailableRepairTargets(creep), structure => {
			if (creep.pos.getRangeTo(structure.pos) > 3) return false;
			return true;
		});

		for (const structure of needsRepair) {
			const maxHealth = this.getStructureMaxHits(structure);
			if (structure.hits > maxHealth - (workParts * 100)) continue;

			creep.repair(structure);
			break;
		}
	}
}
