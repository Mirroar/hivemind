/* global RoomPosition FIND_STRUCTURES STRUCTURE_POWER_BANK OK
POWER_BANK_DECAY FIND_MY_CREEPS HEAL_POWER RANGED_HEAL_POWER HEAL
FIND_DROPPED_RESOURCES RESOURCE_POWER FIND_HOSTILE_CREEPS RANGED_ATTACK
POWER_BANK_HIT_BACK */

import hivemind from 'hivemind';
import Role from 'role/role';

declare global {
	interface Creep {
		_hasAttacked: boolean;
	}
}

export default class PowerHarvesterRole extends Role {
	constructor() {
		super();

		// Power harvesters have high priority because there is a time limit.
		this.stopAt = 0;
		this.throttleAt = 2000;
	}

	/**
	 * Makes a creep act like a power harvester.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep) {
		this.attackNearby(creep);
		this.chaseNearbyRanged(creep);
		if (creep._hasAttacked) return;

		const targetPosition = new RoomPosition(25, 25, creep.memory.targetRoom);
		if (creep.interRoomTravel(targetPosition)) return;
		if (creep.pos.roomName != targetPosition.roomName) return;

		const powerBanks = creep.room.find(FIND_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_POWER_BANK,
		});

		// Update power bank health in memory.
		if (Memory.strategy && Memory.strategy.power && Memory.strategy.power.rooms && Memory.strategy.power.rooms[creep.pos.roomName]) {
			if (powerBanks.length > 0) {
				Memory.strategy.power.rooms[creep.pos.roomName].hits = powerBanks[0].hits;
				Memory.strategy.power.rooms[creep.pos.roomName].decays = Game.time + (powerBanks[0].ticksToDecay || POWER_BANK_DECAY);
			}
			else {
				Memory.strategy.power.rooms[creep.pos.roomName].hits = 0;
			}
		}

		if (powerBanks.length > 0) {
			this.attackPowerBank(creep, powerBanks[0]);
			return;
		}

		const powerResources = creep.room.find(FIND_DROPPED_RESOURCES, {
			filter: resource => resource.resourceType === RESOURCE_POWER,
		});

		if (powerResources.length === 0) {
			// Mark operation as finished.
			if (Memory.strategy && Memory.strategy.power && Memory.strategy.power.rooms && Memory.strategy.power.rooms[creep.memory.targetRoom]) {
				Memory.strategy.power.rooms[creep.memory.targetRoom].isActive = false;
				Memory.strategy.power.rooms[creep.memory.targetRoom].amount = 0;
			}

			// @todo Once we're done harvesting power, switch to escorting the haulers.
			creep.suicide();
		}

		// @todo Move out of the way (use flee), but escort haulers back home.
		const center = new RoomPosition(25, 25, creep.pos.roomName);
		creep.whenInRange(5, center, () => {});
	}

	attackNearby(creep: Creep) {
		if (creep.memory.isHealer) return;

		const targets = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 1, {
			filter: c => !hivemind.relations.isAlly(c.owner.username),
		});
		if (targets.length === 0) return;

		const highestValue = _.max(targets, c => c.getDamageCapacity(1) + (c.getHealCapacity(1) * 2));
		if (!highestValue) return;

		if (creep.attack(highestValue) === OK) {
			creep._hasAttacked = true;

			// Chase if target tries to run away.
			creep.move(creep.pos.getDirectionTo(highestValue.pos));
		}
	}

	chaseNearbyRanged(creep: Creep) {
		if (creep.memory.isHealer) return;
		if (creep._hasAttacked) return;
		if (creep.pos.roomName !== creep.memory.targetRoom) return;

		const targets = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3, {
			filter: c => !hivemind.relations.isAlly(c.owner.username) && _.any(c.body, p => p.type === RANGED_ATTACK),
		});
		if (targets.length === 0) return;

		// @todo Only chase each enemy with 1 power harvester max.
		const highestValue = _.max(targets, c => c.getDamageCapacity(1) + (c.getHealCapacity(1) * 2) - (c.pos.getRangeTo(creep.pos) * 5));
		if (!highestValue) return;

		creep.moveToRange(highestValue.pos, 1);
		creep._hasAttacked = true;
	}

	/**
	 * Makes this creep attack a power bank.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {StructurePowerBank} powerBank
	 *   The power bank to attack.
	 */
	attackPowerBank(creep, powerBank) {
		if (creep.memory.isHealer) {
			const damagedCreep = creep.pos.findClosestByRange(FIND_MY_CREEPS, {
				filter: otherCreep => otherCreep.memory.role === 'harvester.power' && (otherCreep.hits + (otherCreep.incHealing || 0)) < otherCreep.hitsMax,
			});
			// @todo Find most wounded in range 1, failing that, look further away.

			if (damagedCreep) {
				creep.whenInRange(1, damagedCreep, () => {});

				if (creep.heal(damagedCreep) === OK) {
					damagedCreep.incHealing = (damagedCreep.incHealing || 0) + (creep.getActiveBodyparts(HEAL) * HEAL_POWER);
				}
				else if (creep.rangedHeal(damagedCreep) === OK) {
					damagedCreep.incHealing = (damagedCreep.incHealing || 0) + (creep.getActiveBodyparts(HEAL) * RANGED_HEAL_POWER);
				}
			}
			else creep.whenInRange(5, powerBank, () => {});
		}
		else {
			creep.whenInRange(1, powerBank, () => {
				if (creep.hits >= creep.hitsMax * 0.7 || POWER_BANK_HIT_BACK === 0) {
					creep.attack(powerBank);
				}
			});
		}
	}
}
