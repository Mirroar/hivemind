'use strict';

/* global RESOURCE_ENERGY OK FIND_STRUCTURES STRUCTURE_CONTAINER */

const Role = require('./role');
const TransporterRole = require('./role.transporter');
const utilities = require('./utilities');

const UpgraderRole = function () {
	Role.call(this);

	// Upgraders have high priority because we need to praise the GCL!
	this.stopAt = 0;
	this.throttleAt = 2000;

	this.transporterRole = new TransporterRole();
};

UpgraderRole.prototype = Object.create(Role.prototype);

/**
 * Makes a creep behave like an upgrader.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
UpgraderRole.prototype.run = function (creep) {
	if (creep.memory.upgrading && creep.carry.energy === 0) {
		this.setUpgraderState(creep, false);
	}

	if (!creep.memory.upgrading && (creep.carry.energy === creep.carryCapacity || (creep.carry.energy > 0 && creep.room.memory.controllerContainer))) {
		this.setUpgraderState(creep, true);
	}

	if (creep.memory.upgrading) {
		this.performUpgrade(creep);
		return;
	}

	this.performGetUpgraderEnergy(creep);
};

/**
 * Makes the creep use energy reserves to upgrade the room's controller.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 * @param {boolean} allowRefilling
 *   Whether the creep may take energy from controller link or container.
 */
UpgraderRole.prototype.performUpgrade = function (creep, allowRefilling) {
	// Upgrade controller.
	const controller = creep.room.controller;
	const distance = creep.pos.getRangeTo(controller);
	if (distance > 1) {
		creep.moveToRange(controller, 1);
	}

	if (distance <= 3) {
		creep.upgradeController(controller);

		if (distance === 1 && (!controller.sign || controller.sign.username !== utilities.getUsername())) {
			creep.signController(controller, creep.room.decoder.resourceType.replace('symbol_', '') + ' | DM / Slack for decoder access');
		}
	}

	// Keep syphoning energy from link or controller to ideally never stop upgrading.
	if (allowRefilling && _.sum(creep.carry) < creep.carryCapacity * 0.5) {
		let withdrawn = false;
		if (creep.room.memory.controllerLink) {
			const controllerLink = Game.getObjectById(creep.room.memory.controllerLink);
			if (controllerLink && controllerLink.energy > 50 && creep.pos.getRangeTo(controllerLink) <= 1) {
				if (creep.withdraw(controllerLink, RESOURCE_ENERGY) === OK) {
					withdrawn = true;
				}
			}
		}

		if (!withdrawn && creep.room.memory.controllerContainer) {
			const controllerContainer = Game.getObjectById(creep.room.memory.controllerContainer);
			if (controllerContainer && controllerContainer.store.energy > 50 && creep.pos.getRangeTo(controllerContainer) <= 1) {
				if (creep.withdraw(controllerContainer, RESOURCE_ENERGY) === OK) {
					withdrawn = true;
				}
			}
		}
	}
};

/**
 * Makes the creep gather energy as an upgrader.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
UpgraderRole.prototype.performGetUpgraderEnergy = function (creep) {
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
	this.transporterRole.performGetEnergy(creep);

	if (creep.carry.energy > 0) {
		this.setUpgraderState(creep, true);
	}
};

/**
 * Puts this creep into or out of upgrade mode.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 * @param {boolean} upgrading
 *   Whether the creep should be praising the controller.
 */
UpgraderRole.prototype.setUpgraderState = function (creep, upgrading) {
	creep.memory.upgrading = upgrading;
};

module.exports = UpgraderRole;
