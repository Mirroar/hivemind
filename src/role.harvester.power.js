'use strict';

/* global Creep RoomPosition FIND_STRUCTURES STRUCTURE_POWER_BANK
POWER_BANK_DECAY FIND_MY_CREEPS HEAL_POWER RANGED_HEAL_POWER HEAL
FIND_DROPPED_RESOURCES RESOURCE_POWER */

// @todo Once we're done harvesting power, switch to escorting the haulers.

Creep.prototype.runPowerHarvesterLogic = function () {
	if (this.pos.roomName !== this.memory.targetRoom) {
		// @todo Call simple military defense code when necessary.
		this.moveToRoom(this.memory.targetRoom);
		return;
	}

	const powerBanks = this.room.find(FIND_STRUCTURES, {
		filter: structure => structure.structureType === STRUCTURE_POWER_BANK,
	});

	// Update power bank health in memory.
	if (Memory.strategy && Memory.strategy.power && Memory.strategy.power.rooms && Memory.strategy.power.rooms[this.pos.roomName]) {
		if (powerBanks.length > 0) {
			Memory.strategy.power.rooms[this.pos.roomName].hits = powerBanks[0].hits;
			Memory.strategy.power.rooms[this.pos.roomName].decays = Game.time + (powerBanks[0].ticksToDecay || POWER_BANK_DECAY);
		}
		else {
			Memory.strategy.power.rooms[this.pos.roomName].hits = 0;
		}
	}

	if (powerBanks.length > 0) {
		// Go forth and attack!
		const powerBank = powerBanks[0];

		if (this.memory.isHealer) {
			const damagedCreep = this.pos.findClosestByRange(FIND_MY_CREEPS, {
				filter: creep => creep.memory.role === 'harvester.power' && (creep.hits + (creep.incHealing || 0)) < creep.hitsMax,
			});
			// @todo Find most wounded in range 1, failing that, look further away.

			if (damagedCreep) {
				let healPower = HEAL_POWER;
				if (this.pos.getRangeTo(damagedCreep) > 1) {
					this.moveToRange(damagedCreep, 1);
					healPower = RANGED_HEAL_POWER;
				}

				if (this.pos.getRangeTo(damagedCreep) <= 3) {
					this.heal(damagedCreep);
					damagedCreep.incHealing = (damagedCreep.incHealing || 0) + (this.memory.body[HEAL] * healPower);
				}
			}
			else if (this.pos.getRangeTo(powerBank) > 5) {
				this.moveToRange(powerBank, 5);
				return;
			}
		}
		else {
			if (this.pos.getRangeTo(powerBank) > 1) {
				this.moveToRange(powerBank, 1);
				return;
			}

			if (this.hits >= this.hitsMax * 0.7) {
				this.attack(powerBank);
			}
		}

		return;
	}

	const powerResources = this.room.find(FIND_DROPPED_RESOURCES, {
		filter: resource => resource.resourceType === RESOURCE_POWER,
	});

	if (powerResources.length === 0) {
		// Mark operation as finished.
		if (Memory.strategy && Memory.strategy.power && Memory.strategy.power.rooms && Memory.strategy.power.rooms[this.memory.targetRoom]) {
			Memory.strategy.power.rooms[this.memory.targetRoom].isActive = false;
			Memory.strategy.power.rooms[this.memory.targetRoom].amount = 0;
		}

		this.suicide();
	}

	// @todo Move out of the way (use flee), but escort haulers back home.
	const center = new RoomPosition(25, 25, this.pos.roomName);
	if (this.pos.getRangeTo(center) > 5) {
		this.moveToRange(center, 5);
	}
};
