/* global RESOURCE_ENERGY */

import Role from './role';

export default class HelperRole extends Role {
	/**
	 * Makes a creep behave like a helper.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep) {
		if (!creep.room.boostManager) {
			this.parkHelper(creep);
			return;
		}

		const orders = creep.room.boostManager.getLabOrders();

		if (creep.memory.delivering && _.sum(creep.carry) === 0) {
			this.setHelperState(creep, false);
		}
		else if (!creep.memory.delivering && _.sum(creep.carry) === creep.carryCapacity) {
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
	parkHelper(creep) {
		if (!creep.room.roomPlanner) return;

		const targetPos = _.sample(creep.room.roomPlanner.getLocations('helper_parking'));
		if (!targetPos) return;

		if (creep.pos.getRangeTo(targetPos) > 0) {
			creep.goTo(targetPos);
		}
	}

	/**
	 * Puts this creep into or out of deliver mode.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {boolean} delivering
	 *   Whether this creep should be delivering resources.
	 */
	setHelperState(creep, delivering) {
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
	performHelperCleanup(creep, orders) {
		const storage = creep.room.storage;
		const terminal = creep.room.terminal;

		for (const id of _.keys(orders)) {
			const lab: StructureLab = Game.getObjectById(id);
			if (!lab) continue;

			if (lab.mineralType && lab.mineralType !== orders[id].resourceType) {
				if (creep.memory.delivering) {
					// Put everything away.
					let target = terminal;
					if (storage && _.sum(storage.store) + _.sum(creep.carry) < storage.storeCapacity) {
						target = storage;
					}

					if (creep.pos.getRangeTo(target) > 1) {
						creep.moveToRange(target, 1);
					}
					else {
						creep.transferAny(target);
					}
				}
				// Clean out lab.
				else if (creep.pos.getRangeTo(lab) > 1) {
					creep.moveToRange(lab, 1);
				}
				else {
					creep.withdraw(lab, lab.mineralType);
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
	performHelperDeliver(creep, orders) {
		const storage = creep.room.storage;
		const terminal = creep.room.terminal;

		if (this.performHelperLabDeliver(creep, orders)) return;

		// Nothing to do, store excess energy in labs.
		if (creep.carry.energy > 0) {
			const labs = creep.room.getBoostLabs();
			for (const lab of labs) {
				if (lab.energy + creep.carry.energy <= lab.energyCapacity) {
					if (creep.pos.getRangeTo(lab) > 1) {
						creep.moveToRange(lab, 1);
					}
					else {
						creep.transfer(lab, RESOURCE_ENERGY);
					}

					return;
				}
			}
		}

		// Nothing to do, store excess energy in terminal.
		if (creep.carry.energy > 0 && storage && terminal && !creep.room.isClearingTerminal()) {
			if (terminal.store.energy < storage.store.energy * 0.05) {
				if (_.sum(terminal.store) + creep.carry.energy <= terminal.storeCapacity) {
					if (creep.pos.getRangeTo(terminal) > 1) {
						creep.moveToRange(terminal, 1);
					}
					else {
						creep.transfer(terminal, RESOURCE_ENERGY);
					}

					return;
				}
			}
		}

		// Store anything else in storage or terminal.
		let target = terminal;
		if (storage && (!creep.room.isClearingTerminal() || _.sum(storage.store) + _.sum(creep.carry) < storage.storeCapacity)) {
			target = storage;
		}

		if (creep.pos.getRangeTo(target) > 1) {
			creep.moveToRange(target, 1);
		}
		else {
			creep.transferAny(target);
		}
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
	performHelperLabDeliver(creep, orders) {
		for (const id of _.keys(orders)) {
			const lab: StructureLab = Game.getObjectById(id);
			if (!lab) continue;

			const resourceType = orders[id].resourceType;

			if (creep.carry[resourceType] && creep.carry[resourceType] > 0) {
				const diff = orders[id].resourceAmount - (lab.mineralAmount || 0);
				if (diff > 0) {
					if (creep.pos.getRangeTo(lab) > 1) {
						creep.moveToRange(lab, 1);
					}
					else {
						const amount = Math.min(diff, creep.carry[resourceType]);

						creep.transfer(lab, resourceType, amount);
					}

					return true;
				}
			}

			if (creep.carry[RESOURCE_ENERGY] && creep.carry[RESOURCE_ENERGY] > 0) {
				const diff = orders[id].energyAmount - (lab.energy || 0);
				if (diff > 0) {
					if (creep.pos.getRangeTo(lab) > 1) {
						creep.moveToRange(lab, 1);
					}
					else {
						const amount = Math.min(diff, creep.carry[RESOURCE_ENERGY]);

						creep.transfer(lab, RESOURCE_ENERGY, amount);
					}

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
	performHelperGather(creep, orders) {
		const storage = creep.room.storage;
		const terminal = creep.room.terminal;

		if (this.performHelperLabGather(creep, orders)) return;

		// Get energy to fill labs when needed.
		const labs = creep.room.getBoostLabs();
		for (const lab of labs) {
			if (lab.energy + creep.carryCapacity > lab.energyCapacity) continue;

			const target = creep.room.getBestStorageSource(RESOURCE_ENERGY);

			if (creep.pos.getRangeTo(target) > 1) {
				creep.moveToRange(target, 1);
			}
			else {
				creep.withdraw(target, RESOURCE_ENERGY);
			}

			return;
		}

		// Get energy to fill terminal when needed.
		if (storage && terminal && terminal.store.energy < storage.store.energy * 0.05 && !creep.room.isClearingTerminal()) {
			const target = storage;

			if (creep.pos.getRangeTo(target) > 1) {
				creep.moveToRange(target, 1);
			}
			else {
				creep.withdraw(target, RESOURCE_ENERGY);
			}

			return;
		}

		// If we got here, there's nothing left to gather. Deliver what we have stored.
		if (_.sum(creep.carry) > 0) {
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
	performHelperLabGather(creep, orders) {
		for (const id of _.keys(orders)) {
			const order = orders[id];
			const lab: StructureLab = Game.getObjectById(id);
			if (!lab) continue;

			const resourceType = order.resourceType;

			let diff = order.resourceAmount - (creep.carry[resourceType] || 0) - (lab.mineralAmount || 0);
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

					let amount = Math.min(diff, creep.carryCapacity - _.sum(creep.carry));
					amount = Math.min(amount, target.store[resourceType]);
					creep.withdraw(target, resourceType, amount);
				}

				return true;
			}

			diff = order.energyAmount - (creep.carry[RESOURCE_ENERGY] || 0) - (lab.energy || 0);
			if (diff <= 0) continue;

			const target = creep.room.getBestStorageSource(RESOURCE_ENERGY);
			if (creep.pos.getRangeTo(target) > 1) {
				creep.moveToRange(target, 1);
			}
			else {
				const amount = Math.min(diff, creep.carryCapacity - _.sum(creep.carry));

				creep.withdraw(target, RESOURCE_ENERGY, amount);
			}

			return true;
		}

		return false;
	}
}
