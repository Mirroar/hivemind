'use strict';

/* global Creep RESOURCE_ENERGY OK FIND_STRUCTURES STRUCTURE_CONTAINER */

/**
 * Makes the creep use energy reserves to upgrade the room's controller.
 */
Creep.prototype.performUpgrade = function () {
	// Upgrade controller.
	if (this.pos.getRangeTo(this.room.controller) > 3) {
		this.moveToRange(this.room.controller, 1);
	}
	else {
		this.upgradeController(this.room.controller);
		if (this.pos.getRangeTo(this.room.controller) > 1) {
			this.moveToRange(this.room.controller, 1);
		}
	}

	// Keep syphoning energy from link or controller to ideally never stop upgrading.
	// Only real upgraders do this, though, otherwise other primary roles will never stop upgrading.
	if (this.memory.role === 'upgrader' && _.sum(this.carry) < this.carryCapacity * 0.5) {
		let withdrawn = false;
		if (this.room.memory.controllerLink) {
			const controllerLink = Game.getObjectById(this.room.memory.controllerLink);
			if (controllerLink && controllerLink.energy > 50 && this.pos.getRangeTo(controllerLink) <= 1) {
				if (this.withdraw(controllerLink, RESOURCE_ENERGY) === OK) {
					withdrawn = true;
				}
			}
		}

		if (!withdrawn && this.room.memory.controllerContainer) {
			const controllerContainer = Game.getObjectById(this.room.memory.controllerContainer);
			if (controllerContainer && controllerContainer.store.energy > 50 && this.pos.getRangeTo(controllerContainer) <= 1) {
				if (this.withdraw(controllerContainer, RESOURCE_ENERGY) === OK) {
					withdrawn = true;
				}
			}
		}
	}
};

/**
 * Makes the creep gather energy as an upgrader.
 */
Creep.prototype.performGetUpgraderEnergy = function () {
	const creep = this;
	// Ideally, get energy from a link or container close to the controller.
	if (creep.room.memory.controllerLink) {
		const target = Game.getObjectById(creep.room.memory.controllerLink);
		if (target && target.energy > 50) {
			if (creep.pos.getRangeTo(target) > 1) {
				creep.moveToRange(target, 1);
			}
			else {
				creep.withdraw(target, RESOURCE_ENERGY);
			}

			return;
		}
	}

	if (creep.room.memory.controllerContainer) {
		const target = Game.getObjectById(creep.room.memory.controllerContainer);
		if (target && target.store.energy > 50) {
			if (creep.pos.getRangeTo(target) > 1) {
				creep.moveToRange(target, 1);
			}
			else {
				creep.withdraw(target, RESOURCE_ENERGY);
			}

			return;
		}
	}

	// Could also try to get energy from another nearby container.
	const otherContainers = creep.room.controller.pos.findInRange(FIND_STRUCTURES, 3, {
		filter: structure => structure.structureType === STRUCTURE_CONTAINER && structure.store.energy > 0 && structure.id !== creep.room.memory.controllerContainer,
	});
	if (otherContainers && otherContainers.length > 0) {
		if (creep.pos.getRangeTo(otherContainers[0]) > 1) {
			creep.moveToRange(otherContainers[0], 1);
		}
		else {
			creep.withdraw(otherContainers[0], RESOURCE_ENERGY);
		}

		return;
	}

	// Otherwise, get energy from anywhere.
	if (creep.performGetEnergy()) {
		return;
	}

	if (creep.carry.energy > 0) {
		creep.setUpgraderState(true);
	}
};

/**
 * Puts this creep into or out of upgrade mode.
 *
 * @param {boolean} upgrading
 *   Whether the creep should be praising the controller.
 */
Creep.prototype.setUpgraderState = function (upgrading) {
	this.memory.upgrading = upgrading;
};

/**
 * Makes a creep behave like an upgrader.
 */
Creep.prototype.runUpgraderLogic = function () {
	if (this.memory.upgrading && this.carry.energy === 0) {
		this.setUpgraderState(false);
	}

	if (!this.memory.upgrading && (this.carry.energy === this.carryCapacity || (this.carry.energy > 0 && this.room.memory.controllerContainer))) {
		this.setUpgraderState(true);
	}

	if (this.memory.upgrading) {
		this.performUpgrade();
		return;
	}

	this.performGetUpgraderEnergy();
};
