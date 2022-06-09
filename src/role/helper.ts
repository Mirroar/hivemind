/* global RESOURCE_ENERGY */

import Role from 'role/role';

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

		const orders = creep.room.boostManager.getLabOrders();

		if (creep.memory.delivering && creep.store.getUsedCapacity() === 0) {
			this.setHelperState(creep, false);
		}
		else if (!creep.memory.delivering && creep.store.getFreeCapacity() === 0) {
			this.setHelperState(creep, true);
		}

		if (this.performHelperCleanup(creep, orders)) {
			return;
		}

		if (creep.memory.delivering) {
			this.performHelperDeliver(creep, orders);
			return;
		}

		this.performHelperGather(creep, orders);
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
	 * @param {object} orders
	 *   Boosting information, keyed by lab id.
	 *
	 * @return {boolean}
	 *   True if the creep is busy cleaning up resources.
	 */
	performHelperCleanup(creep: HelperCreep, orders: BoostLabsMemory): boolean {
		const storage = creep.room.storage;
		const terminal = creep.room.terminal;

		for (const id of _.keys(orders)) {
			const lab = Game.getObjectById<StructureLab>(id);
			if (!lab) continue;

			if (lab.mineralType && lab.mineralType !== orders[id].resourceType) {
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
	 * @param {object} orders
	 *   Boosting information, keyed by lab id.
	 */
	performHelperDeliver(creep: HelperCreep, orders: BoostLabsMemory) {
		const storage = creep.room.storage;
		const terminal = creep.room.terminal;

		if (this.performHelperLabDeliver(creep, orders)) return;

		// Nothing to do, store excess energy in labs.
		if (creep.store[RESOURCE_ENERGY] > 0) {
			const labs = creep.room.getBoostLabs();
			for (const lab of labs) {
				if (lab.store.getFreeCapacity(RESOURCE_ENERGY) > lab.store.getCapacity(RESOURCE_ENERGY) / 2) {
					creep.whenInRange(1, lab, () => {
						creep.transfer(lab, RESOURCE_ENERGY);
					});

					return;
				}
			}

			// Nothing to do, store excess energy in terminal.
			if (storage && terminal && !creep.room.isClearingTerminal()) {
				if (terminal.store.energy < storage.store.energy * 0.05 && terminal.store.getFreeCapacity() > 0) {
					creep.whenInRange(1, terminal, () => {
						creep.transfer(terminal, RESOURCE_ENERGY);
					});

					return;
				}
			}
		}

		// Store anything else in storage or terminal.
		let target: AnyStoreStructure = terminal;
		if (storage && (!creep.room.isClearingTerminal() || storage.store.getUsedCapacity() + creep.store.getUsedCapacity() < storage.store.getCapacity())) {
			target = storage;
		}

		creep.whenInRange(1, target, () => {
			creep.transferAny(target);
		});
	}

	/**
	 * Makes a helper creep deliver its resources to labs according to orders.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {object} orders
	 *   Boosting information, keyed by lab id.
	 *
	 * @return {boolean}
	 *   Whether a delivery is taking place.
	 */
	performHelperLabDeliver(creep: HelperCreep, orders: BoostLabsMemory): boolean {
		for (const id of _.keys(orders)) {
			const lab = Game.getObjectById<StructureLab>(id);
			if (!lab) continue;

			const resourceType = orders[id].resourceType;

			if (creep.store[resourceType] && creep.store[resourceType] > 0) {
				const diff = orders[id].resourceAmount - (lab.store[lab.mineralType] || 0);
				if (diff > 0) {
					creep.whenInRange(1, lab, () => {
						const amount = Math.min(diff, creep.store[resourceType]);

						creep.transfer(lab, resourceType, amount);
					});

					return true;
				}
			}

			if (creep.store[RESOURCE_ENERGY] && creep.store[RESOURCE_ENERGY] > 0) {
				const diff = orders[id].energyAmount - (lab.store[RESOURCE_ENERGY] || 0);
				if (diff > 0) {
					creep.whenInRange(1, lab, () => {
						const amount = Math.min(diff, creep.store[RESOURCE_ENERGY]);

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
	 * @param {object} orders
	 *   Boosting information, keyed by lab id.
	 */
	performHelperGather(creep: HelperCreep, orders: BoostLabsMemory) {
		const storage = creep.room.storage;
		const terminal = creep.room.terminal;

		if (this.performHelperLabGather(creep, orders)) return;

		// Get energy to fill labs when needed.
		const labs = creep.room.getBoostLabs();
		for (const lab of labs) {
			if (creep.store.getCapacity() > lab.store.getFreeCapacity(RESOURCE_ENERGY)) continue;

			const target = creep.room.getBestStorageSource(RESOURCE_ENERGY);
			creep.whenInRange(1, target, () => {
				creep.withdraw(target, RESOURCE_ENERGY);
			});

			return;
		}

		// Get energy to fill terminal when needed.
		if (storage && terminal && terminal.store.energy < storage.store.energy * 0.05 && !creep.room.isClearingTerminal()) {
			const target = storage;

			creep.whenInRange(1, target, () => {
				creep.withdraw(target, RESOURCE_ENERGY);
			});

			return;
		}

		// If we got here, there's nothing left to gather. Deliver what we have stored.
		if (creep.store.getUsedCapacity() > 0) {
			this.setHelperState(creep, true);
		}

		// After that, just go into parking position.
		this.parkHelper(creep);
	}

	/**
	 * Makes a helper creep gather resources needed for lab orders.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {object} orders
	 *   Boosting information, keyed by lab id.
	 *
	 * @return {boolean}
	 *   Whether the creep is currently fulfilling an order.
	 */
	performHelperLabGather(creep: HelperCreep, orders: BoostLabsMemory): boolean {
		for (const id of _.keys(orders)) {
			const order = orders[id];
			const lab = Game.getObjectById<StructureLab>(id);
			if (!lab) continue;

			const resourceType = order.resourceType;

			let diff = order.resourceAmount - (creep.store[resourceType] || 0) - (lab.store[lab.mineralType] || 0);
			if (diff > 0) {
				const target = creep.room.getBestStorageSource(resourceType);
				if (creep.pos.getRangeTo(target) > 1) {
					creep.moveToRange(target, 1);
				}
				else {
					if (!target || !target.store[resourceType]) {
						// Something went wrong, we don't actually have enough of this stuff.
						// Delete any boost orders using this resource.
						for (const creepName of _.keys(creep.room.boostManager.memory.creepsToBoost)) {
							const resources = creep.room.boostManager.memory.creepsToBoost[creepName];
							if (_.contains(_.keys(resources), resourceType)) {
								delete creep.room.boostManager.memory.creepsToBoost[creepName];
							}
						}

						return true;
					}

					let amount = Math.min(diff, creep.store.getFreeCapacity());
					amount = Math.min(amount, target.store[resourceType]);
					creep.withdraw(target, resourceType, amount);
				}

				return true;
			}

			diff = order.energyAmount - (creep.store[RESOURCE_ENERGY] || 0) - (lab.store[RESOURCE_ENERGY] || 0);
			if (diff <= 0) continue;

			const target = creep.room.getBestStorageSource(RESOURCE_ENERGY);
			creep.whenInRange(1, target, () => {
				const amount = Math.min(diff, creep.store.getFreeCapacity());

				creep.withdraw(target, RESOURCE_ENERGY, amount);
			});

			return true;
		}

		return false;
	}
}
