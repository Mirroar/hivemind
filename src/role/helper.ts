/* global RESOURCE_ENERGY */

import Role from 'role/role';
import {getResourcesIn} from 'utils/store';

declare global {
	interface HelperCreep extends Creep {
		role: 'helper';
		memory: HelperCreepMemory;
		heapMemory: HelperCreepHeapMemory;
	}

	interface HelperCreepMemory extends CreepMemory {
		role: 'helper';
		delivering?: boolean;
	}

	interface HelperCreepHeapMemory extends CreepHeapMemory {
	}
}

export default class HelperRole extends Role {
	/**
	 * Makes a creep behave like a helper.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: HelperCreep) {
		if (!creep.room.boostManager) {
			this.parkHelper(creep);
			return;
		}

		if (creep.memory.delivering && creep.store.getUsedCapacity() === 0) {
			this.setHelperState(creep, false);
		}
		else if (!creep.memory.delivering && creep.store.getFreeCapacity() === 0) {
			this.setHelperState(creep, true);
		}

		if (this.performHelperCleanup(creep)) {
			return;
		}

		if (creep.memory.delivering) {
			this.performHelperDeliver(creep);
			return;
		}

		this.performHelperGather(creep);
	}

	/**
	 * Moves a helper creep to its designated parking spot.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	parkHelper(creep: HelperCreep) {
		if (!creep.room.roomPlanner) return;

		const targetPos = _.sample(creep.room.roomPlanner.getLocations('helper_parking'));
		if (!targetPos) return;

		creep.whenInRange(1, targetPos, () => {
			// Wait around helpfully!
		});
	}

	/**
	 * Puts this creep into or out of deliver mode.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {boolean} delivering
	 *   Whether this creep should be delivering resources.
	 */
	setHelperState(creep: HelperCreep, delivering: boolean) {
		creep.memory.delivering = delivering;
	}

	/**
	 * Checks if any of the labs have the wrong mineral type assigned, and clears those out.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @return {boolean}
	 *   True if the creep is busy cleaning up resources.
	 */
	performHelperCleanup(creep: HelperCreep): boolean {
		const storage = creep.room.storage;
		const terminal = creep.room.terminal;

		const boostManager = creep.room.boostManager;
		const boostLabs = boostManager.getBoostLabs();
		for (const lab of boostLabs) {
			if (lab.mineralType && lab.mineralType !== boostManager.getRequiredBoostType(lab.id)) {
				if (creep.memory.delivering) {
					// Put everything away.
					let target: AnyStoreStructure = terminal;
					if (storage && storage.store.getUsedCapacity() + creep.store.getUsedCapacity() < storage.store.getCapacity()) {
						target = storage;
					}

					creep.whenInRange(1, target, () => {
						creep.transferAny(target);
					});
				}
				// Clean out lab.
				else {
					creep.whenInRange(1, lab, () => {
						creep.withdraw(lab, lab.mineralType);
					});
				}

				return true;
			}
		}

		return false;
	}

	/**
	 * Makes a helper creep deliver its resources.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performHelperDeliver(creep: HelperCreep) {
		const storage = creep.room.storage;
		const terminal = creep.room.terminal;

		if (this.performHelperLabDeliver(creep)) return;

		// Store anything else in storage or terminal.
		const resourceType = getResourcesIn(creep.store)[0];
		const target = creep.room.getBestStorageTarget(creep.store[resourceType], resourceType);

		creep.whenInRange(1, target, () => {
			creep.transfer(target, resourceType);
		});
	}

	/**
	 * Makes a helper creep deliver its resources to labs according to orders.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @return {boolean}
	 *   Whether a delivery is taking place.
	 */
	performHelperLabDeliver(creep: HelperCreep): boolean {
		const boostManager = creep.room.boostManager;
		const boostLabs = boostManager.getBoostLabs();
		for (const lab of boostLabs) {
			const resourceType = boostManager.getRequiredBoostType(lab.id);

			if (creep.store.getUsedCapacity(resourceType) > 0) {
				const diff = boostManager.getRequiredBoostAmount(lab.id) - lab.store.getUsedCapacity(resourceType);
				const amount = Math.min(diff, creep.store[resourceType], lab.store.getFreeCapacity(resourceType));
				if (amount > 0) {
					creep.whenInRange(1, lab, () => {
						creep.transfer(lab, resourceType, amount);
					});

					return true;
				}
			}

			if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
				const diff = boostManager.getRequiredEnergyAmount(lab.id) - lab.store.getUsedCapacity(RESOURCE_ENERGY);
				const amount = Math.min(diff, creep.store[RESOURCE_ENERGY], lab.store.getFreeCapacity(RESOURCE_ENERGY));
				if (amount > 0) {
					creep.whenInRange(1, lab, () => {
						creep.transfer(lab, RESOURCE_ENERGY, amount);
					});

					return true;
				}
			}
		}

		return false;
	}

	/**
	 * Makes a helper creep gather resources.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performHelperGather(creep: HelperCreep) {
		const storage = creep.room.storage;
		const terminal = creep.room.terminal;

		if (this.performHelperLabGather(creep)) return;

		// Get energy to fill labs when needed.
		const boostManager = creep.room.boostManager;
		const labs = boostManager.getBoostLabs();
		const totalNeededEnergy = _.sum(labs, lab => boostManager.getRequiredEnergyAmount(lab.id));
		const target = creep.room.getBestStorageSource(RESOURCE_ENERGY);
		const amount = Math.min(totalNeededEnergy, creep.store.getFreeCapacity(RESOURCE_ENERGY), target.store.getUsedCapacity(RESOURCE_ENERGY));
		if (amount > 0) {
			creep.whenInRange(1, target, () => {
				creep.withdraw(target, RESOURCE_ENERGY, amount);
			});

			return;
		}

		// If we got here, there's nothing left to gather. Deliver what we have stored.
		if (creep.store.getUsedCapacity() > 0) {
			this.setHelperState(creep, true);

			return;
		}

		// Failing that, just go into parking position.
		this.parkHelper(creep);
	}

	/**
	 * Makes a helper creep gather resources needed for lab orders.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @return {boolean}
	 *   Whether the creep is currently fulfilling an order.
	 */
	performHelperLabGather(creep: HelperCreep): boolean {
		const boostManager = creep.room.boostManager;
		const boostLabs = boostManager.getBoostLabs();
		for (const lab of boostLabs) {
			const resourceType = boostManager.getRequiredBoostType(lab.id);

			let diff = boostManager.getRequiredBoostAmount(lab.id) - creep.store.getUsedCapacity(resourceType) - lab.store.getUsedCapacity(resourceType);
			if (diff <= 0) continue;

			const target = creep.room.getBestStorageSource(resourceType);
			let amount = Math.min(diff, creep.store.getFreeCapacity(resourceType), target.store.getUsedCapacity(resourceType));
			if (amount > 0) {
				creep.whenInRange(1, target, () => {
					creep.withdraw(target, resourceType, amount);
				});

				return true;
			}
		}

		return false;
	}
}
