/* global RESOURCE_ENERGY OK FIND_STRUCTURES STRUCTURE_CONTAINER WORK
UPGRADE_CONTROLLER_POWER */

import balancer from 'excess-energy-balancer';
import Role from 'role/role';
import TransporterRole from 'role/transporter';

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
	run(creep) {
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
	performUpgrade(creep, allowRefilling) {
		// Upgrade controller.
		const controller = creep.room.controller;
		const distance = creep.pos.getRangeTo(controller);
		if (distance > 1) {
			creep.moveToRange(controller, 1);
			// @todo If there are no free tiles at range 1, stay at range 2, etc.
			// to save movement intents and pathfinding.
		}

		if (distance <= 3) {
			const result = creep.upgradeController(controller);
			if (controller.level == 8 && result == OK) {
				const amount = Math.min(creep.store[RESOURCE_ENERGY], creep.getActiveBodyparts(WORK) * UPGRADE_CONTROLLER_POWER);
				balancer.recordGplEnergy(amount);
			}

			if (distance === 1 && controller.sign && controller.sign.username) {
				creep.signController(controller, '');
			}
		}

		// Keep syphoning energy from link or controller to ideally never stop upgrading.
		// @todo Do it when energy is less than 2 ticks of upgrading.
		if (allowRefilling && creep.store.getUsedCapacity() < creep.store.getCapacity() * 0.5) {
			let withdrawn = false;
			if (creep.room.memory.controllerLink) {
				const controllerLink = Game.getObjectById<StructureLink>(creep.room.memory.controllerLink);
				if (controllerLink && controllerLink.energy > 50 && creep.pos.getRangeTo(controllerLink) <= 1) {
					if (creep.withdraw(controllerLink, RESOURCE_ENERGY) === OK) {
						withdrawn = true;
					}
				}
			}

			if (!withdrawn && creep.room.memory.controllerContainer) {
				const controllerContainer = Game.getObjectById<StructureContainer>(creep.room.memory.controllerContainer);
				if (controllerContainer && controllerContainer.store.energy > 50 && creep.pos.getRangeTo(controllerContainer) <= 1) {
					if (creep.withdraw(controllerContainer, RESOURCE_ENERGY) === OK) {
						withdrawn = true;
					}
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
	performGetUpgraderEnergy(creep) {
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
		const droppedResources = creep.room.controller.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
			filter: resource => resource.resourceType === RESOURCE_ENERGY,
		});
		if (droppedResources.length > 0) {
			creep.whenInRange(1, droppedResources[0], () => {
				creep.pickup(droppedResources[0]);
			});

			return;
		}

		// Could also try to get energy from another nearby container.
		const otherContainers = creep.room.controller.pos.findInRange(FIND_STRUCTURES, 3, {
			filter: structure => structure.structureType === STRUCTURE_CONTAINER && structure.store.energy > 0 && structure.id !== creep.room.memory.controllerContainer,
		});
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

		// If all else fails and we can't excpect resupply, look for energy ourselves.
		if (!creep.room.memory.controllerLink && !creep.room.memory.controllerContainer) {
			this.transporterRole.performGetEnergy(creep);
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
	setUpgraderState(creep, upgrading) {
		creep.memory.upgrading = upgrading;
	}
}
