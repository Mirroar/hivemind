'use strict';

/* global Creep RESOURCE_POWER FIND_STRUCTURES STRUCTURE_POWER_BANK
FIND_DROPPED_RESOURCES */

Creep.prototype.runPowerHaulerLogic = function () {
	if (this.memory.isReturning) {
		if (this.pos.roomName !== this.memory.sourceRoom) {
			this.moveToRoom(this.memory.sourceRoom);
			return;
		}

		// @todo Put power in storage.
		if ((this.carry[RESOURCE_POWER] || 0) > 0) {
			const target = this.room.getBestStorageTarget(this.carry[RESOURCE_POWER], RESOURCE_POWER);

			if (target) {
				if (this.pos.getRangeTo(target) > 1) {
					this.moveToRange(target, 1);
					return;
				}

				this.transferAny(target);
				return;
			}

			// Whelp, no delivery target. Let transporters handle it.
			this.drop(RESOURCE_POWER);
		}
		else {
			delete this.memory.isReturning;
		}

		return;
	}

	if (this.pos.roomName !== this.memory.targetRoom) {
		this.moveToRoom(this.memory.targetRoom);
		return;
	}

	const powerBanks = this.room.find(FIND_STRUCTURES, {
		filter: structure => structure.structureType === STRUCTURE_POWER_BANK,
	});

	if (powerBanks.length > 0) {
		// Wait close by until power bank is destroyed.
		const powerBank = powerBanks[0];
		if (this.pos.getRangeTo(powerBank) > 5) {
			this.moveToRange(powerBank, 5);
		}

		return;
	}

	const powerResources = this.room.find(FIND_DROPPED_RESOURCES, {
		filter: resource => resource.resourceType === RESOURCE_POWER,
	});

	if (_.sum(this.carry) >= this.carryCapacity || powerResources.length === 0) {
		// Return home.
		this.memory.isReturning = true;
		return;
	}

	if (powerResources.length <= 0) {
		// Return home.
		if (_.sum(this.carry) > 0) {
			this.memory.isReturning = true;
		}

		// Mark operation as finished.
		if (Memory.strategy && Memory.strategy.power && Memory.strategy.power.rooms && Memory.strategy.power.rooms[this.memory.targetRoom]) {
			Memory.strategy.power.rooms[this.memory.targetRoom].isActive = false;
			Memory.strategy.power.rooms[this.memory.targetRoom].amount = 0;
		}

		return;
	}

	if (this.pos.getRangeTo(powerResources[0]) > 1) {
		this.moveToRange(powerResources[0], 1);
		return;
	}

	this.pickup(powerResources[0]);
};
