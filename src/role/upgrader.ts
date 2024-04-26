/* global RESOURCE_ENERGY OK STRUCTURE_CONTAINER WORK
UPGRADE_CONTROLLER_POWER */

import balancer from 'excess-energy-balancer';
import cache from 'utils/cache';
import Role from 'role/role';
import TransporterRole from 'role/transporter';

declare global {
	interface UpgraderCreep extends Creep {
		memory: UpgraderCreepMemory;
		heapMemory: UpgraderCreepHeapMemory;
	}

	interface UpgraderCreepMemory extends CreepMemory {
		role: 'upgrader';
		upgrading?: boolean;
	}

	interface UpgraderCreepHeapMemory extends CreepHeapMemory {
		currentRcl?: number;
	}
}

export default class UpgraderRole extends Role {
	transporterRole: TransporterRole;

	constructor() {
		super();

		// Upgraders have high priority because we need to praise the GCL!
		this.stopAt = 0;
		this.throttleAt = 2000;

		this.transporterRole = new TransporterRole();
	}

	/**
	 * Makes a creep behave like an upgrader.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: UpgraderCreep) {
		if (!creep.heapMemory.currentRcl) {
			creep.heapMemory.currentRcl = creep.room.controller.level;
		}
		else if (
			creep.heapMemory.currentRcl !== creep.room.controller.level
			&& creep.room.find(FIND_MY_CONSTRUCTION_SITES).length > 0
			&& creep.room.controller.level < 5
		) {
			// In low level rooms, stop upgrading and build on RCL up.
			delete creep.memory.upgrading;
			const builderCreep = creep as unknown as BuilderCreep;
			builderCreep.memory.role = 'builder';
			return;
		}

		if (creep.memory.upgrading && creep.store[RESOURCE_ENERGY] === 0) {
			this.setUpgraderState(creep, false);
		}

		if (!creep.memory.upgrading && (creep.store[RESOURCE_ENERGY] === creep.store.getCapacity() || (creep.store[RESOURCE_ENERGY] > 0 && creep.room.memory.controllerContainer))) {
			this.setUpgraderState(creep, true);
		}

		if (creep.memory.upgrading) {
			this.performUpgrade(creep, true);
			return;
		}

		this.performGetUpgraderEnergy(creep);
	}

	/**
	 * Makes the creep use energy reserves to upgrade the room's controller.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {boolean} allowRefilling
	 *   Whether the creep may take energy from controller link or container.
	 */
	performUpgrade(creep: UpgraderCreep, allowRefilling: boolean) {
		// Upgrade controller.
		const controller = creep.room.controller;
		const distance = creep.pos.getRangeTo(controller);
		const isOnlyUpgrader = creep.memory.role === 'upgrader' && _.size(creep.room.creepsByRole.upgrader) === 1;
		if (distance > 3 && isOnlyUpgrader) {
			const upgraderPosition = cache.inHeap('upgraderPosition:' + creep.room.name, 500, () => {
				if (!creep.room.roomPlanner) return null;

				// Get harvest position from room planner.
				return _.sample(creep.room.roomPlanner.getLocations('upgrader.0'));
			});
			if (upgraderPosition) creep.goTo(upgraderPosition);
			else creep.moveToRange(controller, 3);
		}
		else {
			creep.whenInRange(3, controller, () => {
				const result = creep.upgradeController(controller);
				if (controller.level == 8 && result == OK) {
					const amount = Math.min(creep.store[RESOURCE_ENERGY], creep.getActiveBodyparts(WORK) * UPGRADE_CONTROLLER_POWER);
					balancer.recordGplEnergy(amount);
				}

				if (distance === 1 && controller.sign && controller.sign.username) {
					creep.signController(controller, '');
				}
			});
		}

		// Keep syphoning energy from link or controller to ideally never stop upgrading.
		// Do it when stored energy is less than 2 ticks worth of upgrading.
		const workParts = creep.getActiveBodyparts(WORK);
		if (allowRefilling && creep.store.getUsedCapacity() < workParts * 2) {
			let withdrawn = false;
			if (creep.room.memory.controllerLink) {
				const controllerLink = Game.getObjectById<StructureLink>(creep.room.memory.controllerLink);
				if (controllerLink && controllerLink.energy > 50 && creep.pos.getRangeTo(controllerLink) <= 1 && creep.withdraw(controllerLink, RESOURCE_ENERGY) === OK) {
					withdrawn = true;
				}
			}

			if (!withdrawn && creep.room.memory.controllerContainer) {
				const controllerContainer = Game.getObjectById<StructureContainer>(creep.room.memory.controllerContainer);
				if (controllerContainer && controllerContainer.store.energy > 50 && creep.pos.getRangeTo(controllerContainer) <= 1 && creep.withdraw(controllerContainer, RESOURCE_ENERGY) === OK) {
					withdrawn = true;
				}
			}
		}
	}

	/**
	 * Makes the creep gather energy as an upgrader.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performGetUpgraderEnergy(creep: UpgraderCreep) {
		// Ideally, get energy from a link or container close to the controller.
		if (creep.room.memory.controllerLink) {
			const target = Game.getObjectById<StructureLink>(creep.room.memory.controllerLink);
			if (target && target.energy > 50) {
				creep.whenInRange(1, target, () => {
					creep.withdraw(target, RESOURCE_ENERGY);
				});

				return;
			}
		}

		if (creep.room.memory.controllerContainer) {
			const target = Game.getObjectById<StructureContainer>(creep.room.memory.controllerContainer);
			if (target && target.store.energy > 50) {
				creep.whenInRange(1, target, () => {
					creep.withdraw(target, RESOURCE_ENERGY);
				});

				return;
			}
		}

		// Check the ground for nearby energy to pick up.
		const droppedResources = creep.room.controller.pos.findInRange(FIND_DROPPED_RESOURCES, creep.room.controller.level < 4 ? 10 : 3, {
			filter: resource => resource.resourceType === RESOURCE_ENERGY && resource.amount >= creep.store.getCapacity(),
		});
		if (droppedResources.length > 0) {
			creep.whenInRange(1, droppedResources[0], () => {
				creep.pickup(droppedResources[0]);
			});

			return;
		}

		// Could also try to get energy from another nearby container.
		const otherContainers = _.filter(
			creep.room.structuresByType[STRUCTURE_CONTAINER],
			structure => 
				structure.store.energy > CONTAINER_CAPACITY / 4
				&& structure.id !== creep.room.memory.controllerContainer
				&& creep.room.controller.pos.getRangeTo(structure.pos) <= (creep.room.controller.level < 4 ? 10 : 3),
		);
		if (otherContainers.length > 0) {
			creep.whenInRange(1, otherContainers[0], () => {
				creep.withdraw(otherContainers[0], RESOURCE_ENERGY);
			});

			return;
		}

		// Can't pick up anything. Continue upgrading if possible.
		if (creep.store[RESOURCE_ENERGY] > 0) {
			this.setUpgraderState(creep, true);
		}

		const deliveringCreeps = creep.room.getCreepsWithOrder('workerCreep', creep.id);
		if (deliveringCreeps.length > 0) {
			creep.moveToRange(deliveringCreeps[0], 1);
			return;
		}

		// If all else fails and we can't excpect resupply, look for energy ourselves.
		if (!creep.room.memory.controllerLink && !creep.room.memory.controllerContainer) {
			this.transporterRole.performGetEnergy(creep as unknown as TransporterCreep);
		}
	}

	/**
	 * Puts this creep into or out of upgrade mode.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {boolean} upgrading
	 *   Whether the creep should be praising the controller.
	 */
	setUpgraderState(creep: UpgraderCreep, upgrading: boolean) {
		creep.memory.upgrading = upgrading;
	}
}
