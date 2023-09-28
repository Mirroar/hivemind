/* global RoomPosition RESOURCE_POWER FIND_STRUCTURES ATTACK_POWER
STRUCTURE_POWER_BANK FIND_DROPPED_RESOURCES FIND_RUINS MAX_CREEP_SIZE
FIND_TOMBSTONES */

import Role from 'role/role';
import {getResourcesIn} from 'utils/store';

declare global {
	interface PowerHaulerCreep extends Creep {
		memory: PowerHaulerCreepMemory;
		heapMemory: PowerHaulerCreepHeapMemory;
	}

	interface PowerHaulerCreepMemory extends CreepMemory {
		role: 'hauler.power';
		delivering?: boolean;
		isReturning?: boolean;
		sourceRoom: string;
		targetRoom: string;
		pickupTarget?: Id<Resource | Ruin | Tombstone>;
	}

	interface PowerHaulerCreepHeapMemory extends CreepHeapMemory {
	}
}

export default class PowerHaulerRole extends Role {
	/**
	 * Makes a creep act like a power hauler.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: PowerHaulerCreep) {
		if (!creep.memory.isReturning && (creep.store.getFreeCapacity() === 0 || (creep.store.power || 0) > creep.store.getCapacity() / 10)) {
			// Return home.
			creep.memory.isReturning = true;
			return;
		}

		if (creep.memory.isReturning) {
			this.returnHome(creep);
			return;
		}

		const targetPosition = new RoomPosition(25, 25, creep.memory.targetRoom);
		const isInTargetRoom = creep.pos.roomName === targetPosition.roomName;

		// Pick up dropped power in rooms we pass.
		if (!isInTargetRoom && this.pickupResources(creep, RESOURCE_POWER)) return;

		// Get to target room.
		if (creep.interRoomTravel(targetPosition)) return;
		if (creep.pos.roomName !== targetPosition.roomName) return;

		const powerBanks = creep.room.find(FIND_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_POWER_BANK,
		});

		if (powerBanks.length > 0) {
			const powerBank = powerBanks[0];
			// Get close to power bank if it's close to being destoryed.
			if (powerBank.hits < ATTACK_POWER * MAX_CREEP_SIZE * 5) {
				creep.whenInRange(1, powerBank, () => {});

				// Also drop anything that's not power, it can be picked up again once
				// power is depleted.
				if (creep.store.getUsedCapacity() > (creep.store[RESOURCE_POWER] || 0)) {
					for (const resourceType of getResourcesIn(creep.store)) {
						if (resourceType === RESOURCE_POWER) continue;
						if (!creep.store[resourceType]) continue;
						creep.drop(resourceType);
						break;
					}
				}

				return;
			}

			// Pick up things in the room while waiting.
			if (this.pickupResources(creep)) return;

			// Wait close by until power bank is destroyed.
			creep.whenInRange(5, powerBank, () => {});
			return;
		}

		this.pickupPower(creep);
	}

	/**
	 * Makes the hauler return to its source room.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	returnHome(creep: PowerHaulerCreep) {
		const targetPosition = new RoomPosition(25, 25, creep.memory.sourceRoom);
		const isInTargetRoom = creep.pos.roomName === targetPosition.roomName;

		// Pick up dropped power in rooms we pass.
		if (!isInTargetRoom && creep.store.getFreeCapacity() > 0 && this.pickupResources(creep, RESOURCE_POWER)) return;

		if (creep.interRoomTravel(targetPosition)) return;
		if (creep.pos.roomName !== targetPosition.roomName) return;

		// Put resources in storage.
		if (creep.store.getUsedCapacity() > 0) {
			for (const resourceType of RESOURCES_ALL) {
				if ((creep.store[resourceType] || 0) === 0) continue;

				const target = creep.room.getBestStorageTarget(creep.store[resourceType], resourceType);

				if (target) {
					creep.whenInRange(1, target, () => {
						creep.transfer(target, resourceType);
					});

					return;
				}

				// Whelp, no delivery target. Let transporters handle it.
				creep.drop(resourceType);
				return;
			}
		}
		else {
			delete creep.memory.isReturning;
		}
	}

	/**
	 * Makes the hauler pick up power from the ground.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	pickupPower(creep: PowerHaulerCreep) {
		const powerResources = creep.room.find(FIND_DROPPED_RESOURCES, {
			filter: resource => resource.resourceType === RESOURCE_POWER,
		});
		if (powerResources.length > 0) {
			creep.whenInRange(1, powerResources[0], () => {
				creep.pickup(powerResources[0]);
			});

			return;
		}

		const powerRuins = creep.room.find(FIND_RUINS, {
			filter: ruin => (ruin.store.power || 0) > 0,
		});
		if (powerRuins.length > 0) {
			creep.whenInRange(1, powerRuins[0], () => {
				creep.withdraw(powerRuins[0], RESOURCE_POWER);
			});

			return;
		}

		// Mark operation as finished.
		if (Memory.strategy && Memory.strategy.power && Memory.strategy.power.rooms && Memory.strategy.power.rooms[creep.memory.targetRoom]) {
			Memory.strategy.power.rooms[creep.memory.targetRoom].isActive = false;
			Memory.strategy.power.rooms[creep.memory.targetRoom].amount = 0;
		}

		// Loot anything else nearby, like tombstones and dropped resources.
		if (this.pickupResources(creep)) return;

		// Return home.
		creep.memory.isReturning = true;
	}

	pickupResources(creep: PowerHaulerCreep, resourceType?: ResourceConstant) {
		let target;
		if (creep.memory.pickupTarget) {
			target = Game.getObjectById(creep.memory.pickupTarget);

			if (!target) {
				delete creep.memory.pickupTarget;
			}
			else if (target.store && (target.store.getUsedCapacity() === 0 || (resourceType && (target.store[resourceType] || 0) === 0))) {
				// Target doesn't contain the required resource anymore.
				delete creep.memory.pickupTarget;
				target = null;
			}
		}

		if (!target) {
			const resources = creep.room.find(FIND_DROPPED_RESOURCES, {
				filter: resource => resource.amount >= 10 && (!resourceType || resource.resourceType === resourceType),
			});
			const ruins = creep.room.find(FIND_RUINS, {
				filter: ruin => ruin.store.getUsedCapacity(resourceType) >= 10,
			});
			const tombs = creep.room.find(FIND_TOMBSTONES, {
				filter: tomb => tomb.store.getUsedCapacity(resourceType) >= 10,
			});

			for (const collection of [resources, ruins, tombs]) {
				if (collection.length === 0) continue;

				creep.memory.pickupTarget = collection[0].id;
				target = collection[0];
				break;
			}
		}

		if (!target) return false;
		creep.whenInRange(1, target, () => {
			if (target.amount) {
				creep.pickup(target);
			}
			else {
				creep.withdraw(target, resourceType || getResourcesIn(target.store)[0]);
			}
		});

		return true;
	}
}
