'use strict';

/* global Creep RESOURCE_ENERGY */

/**
 * Makes a helper creep deliver its resources.
 */
Creep.prototype.performHelperDeliver = function () {
	const storage = this.room.storage;
	const terminal = this.room.terminal;

	if (this.performHelperLabDeliver()) return;

	// Nothing to do, store excess energy in labs.
	if (this.carry.energy > 0) {
		const labs = this.room.getBoostLabs();
		for (const lab of labs) {
			if (lab.energy + this.carry.energy <= lab.energyCapacity) {
				if (this.pos.getRangeTo(lab) > 1) {
					this.moveToRange(lab, 1);
				}
				else {
					this.transfer(lab, RESOURCE_ENERGY);
				}

				return;
			}
		}
	}

	// Nothing to do, store excess energy in terminal.
	if (this.carry.energy > 0 && storage && terminal && !this.room.isClearingTerminal()) {
		if (terminal.store.energy < storage.store.energy * 0.05) {
			if (_.sum(terminal.store) + this.carry.energy <= terminal.storeCapacity) {
				if (this.pos.getRangeTo(terminal) > 1) {
					this.moveToRange(terminal, 1);
				}
				else {
					this.transfer(terminal, RESOURCE_ENERGY);
				}

				return;
			}
		}
	}

	// Store anything else in storage or terminal.
	let target = terminal;
	if (storage && (!this.room.isClearingTerminal() || _.sum(storage.store) + _.sum(this.carry) < storage.storeCapacity)) {
		target = storage;
	}

	if (this.pos.getRangeTo(target) > 1) {
		this.moveToRange(target, 1);
	}
	else {
		this.transferAny(target);
	}
};

/**
 * Makes a helper creep deliver its resources to labs according to orders.
 *
 * @return {boolean}
 *   Whether a delivery is taking place.
 */
Creep.prototype.performHelperLabDeliver = function () {
	for (const id of _.keys(this.orders)) {
		const lab = Game.getObjectById(id);
		if (!lab) continue;

		const resourceType = this.orders[id].resourceType;

		if (this.carry[resourceType] && this.carry[resourceType] > 0) {
			const diff = this.orders[id].resourceAmount - (lab.mineralAmount || 0);
			if (diff > 0) {
				if (this.pos.getRangeTo(lab) > 1) {
					this.moveToRange(lab, 1);
				}
				else {
					const amount = Math.min(diff, this.carry[resourceType]);

					this.transfer(lab, resourceType, amount);
				}

				return true;
			}
		}

		if (this.carry[RESOURCE_ENERGY] && this.carry[RESOURCE_ENERGY] > 0) {
			const diff = this.orders[id].energyAmount - (lab.energy || 0);
			if (diff > 0) {
				if (this.pos.getRangeTo(lab) > 1) {
					this.moveToRange(lab, 1);
				}
				else {
					const amount = Math.min(diff, this.carry[RESOURCE_ENERGY]);

					this.transfer(lab, RESOURCE_ENERGY, amount);
				}

				return true;
			}
		}
	}
};

/**
 * Makes a helper creep gather resources.
 */
Creep.prototype.performHelperGather = function () {
	const storage = this.room.storage;
	const terminal = this.room.terminal;

	if (this.performHelperLabGather()) return;

	// Get energy to fill labs when needed.
	const labs = this.room.getBoostLabs();
	for (const lab of labs) {
		if (lab.energy + this.carryCapacity > lab.energyCapacity) continue;

		let target = terminal;
		if (storage && (storage.store[RESOURCE_ENERGY] || 0) > 0) {
			target = storage;
		}

		if (this.pos.getRangeTo(target) > 1) {
			this.moveToRange(target, 1);
		}
		else {
			this.withdraw(target, RESOURCE_ENERGY);
		}

		return;
	}

	// Get energy to fill terminal when needed.
	if (storage && terminal && terminal.store.energy < storage.store.energy * 0.05 && !this.room.isClearingTerminal()) {
		const target = storage;

		if (this.pos.getRangeTo(target) > 1) {
			this.moveToRange(target, 1);
		}
		else {
			this.withdraw(target, RESOURCE_ENERGY);
		}

		return;
	}

	// If we got here, there's nothing left to gather. Deliver what we have stored.
	if (_.sum(this.carry) > 0) {
		this.setHelperState(true);
	}

	// After that, just go into parking position.
	this.parkHelper();
};

/**
 * Makes a helper creep gather resources needed for lab orders.
 *
 * @return {boolean}
 *   Whether the creep is currently fulfilling an order.
 */
Creep.prototype.performHelperLabGather = function () {
	for (const id of _.keys(this.orders)) {
		const order = this.orders[id];
		const lab = Game.getObjectById(id);
		if (!lab) continue;

		const resourceType = order.resourceType;

		let diff = order.resourceAmount - (this.carry[resourceType] || 0) - (lab.mineralAmount || 0);
		if (diff > 0) {
			const target = this.room.getBestStorageSource(resourceType);
			if (this.pos.getRangeTo(target) > 1) {
				this.moveToRange(target, 1);
			}
			else {
				let amount = Math.min(diff, this.carryCapacity - _.sum(this.carry));
				amount = Math.min(amount, target.store[resourceType]);

				if (!target.store[resourceType]) {
					// Something went wrong, we don't actually have enough of this stuff.
					// Delete any boost orders using this resource.
					this.room.boostManager.memory.creepsToBoost = _.filter(
						this.room.boostManager.memory.creepsToBoost,
						resources => !_.contains(_.keys(resources), resourceType)
					);

					return true;
				}

				this.withdraw(target, resourceType, amount);
			}

			return true;
		}

		diff = order.energyAmount - (this.carry[RESOURCE_ENERGY] || 0) - (lab.energy || 0);
		if (diff <= 0) continue;

		const target = this.room.getBestStorageSource(RESOURCE_ENERGY);
		if (this.pos.getRangeTo(target) > 1) {
			this.moveToRange(target, 1);
		}
		else {
			const amount = Math.min(diff, this.carryCapacity - _.sum(this.carry));

			this.withdraw(target, RESOURCE_ENERGY, amount);
		}

		return true;
	}
};

/**
 * Checks if any of the labs have the wrong mineral type assigned, and clears those out.
 */
Creep.prototype.performHelperCleanup = function () {
	const storage = this.room.storage;
	const terminal = this.room.terminal;

	for (const id of _.keys(this.orders)) {
		const lab = Game.getObjectById(id);
		if (!lab) continue;

		if (lab.mineralType && lab.mineralType !== this.orders[id].resourceType) {
			if (this.memory.delivering) {
				// Put everything away.
				let target = terminal;
				if (storage && _.sum(storage.store) + _.sum(this.carry) < storage.storeCapacity) {
					target = storage;
				}

				if (this.pos.getRangeTo(target) > 1) {
					this.moveToRange(target, 1);
				}
				else {
					this.transferAny(target);
				}
			}
			// Clean out lab.
			else if (this.pos.getRangeTo(lab) > 1) {
				this.moveToRange(lab, 1);
			}
			else {
				this.withdraw(lab, lab.mineralType);
			}

			break;
		}
	}
};

/**
 * Moves a helper creep to its designated parking spot.
 */
Creep.prototype.parkHelper = function () {
	const flagName = 'Helper:' + this.pos.roomName;
	if (Game.flags[flagName]) {
		const flag = Game.flags[flagName];
		if (this.pos.getRangeTo(flag) > 0) {
			this.moveToRange(flag, 0);
		}
	}
};

/**
 * Puts this creep into or out of deliver mode.
 *
 * @param {boolean} delivering
 *   Whether this creep should be delivering resources.
 */
Creep.prototype.setHelperState = function (delivering) {
	this.memory.delivering = delivering;
};

/**
 * Makes a creep behave like a helper.
 */
Creep.prototype.runHelperLogic = function () {
	if (!this.room.boostManager) {
		this.parkHelper();
		return;
	}

	this.orders = this.room.boostManager.getLabOrders();

	if (this.memory.delivering && _.sum(this.carry) === 0) {
		this.setHelperState(false);
	}
	else if (!this.memory.delivering && _.sum(this.carry) === this.carryCapacity) {
		this.setHelperState(true);
	}

	if (this.performHelperCleanup()) {
		return;
	}

	if (this.memory.delivering) {
		this.performHelperDeliver();
		return;
	}

	this.performHelperGather();
};
