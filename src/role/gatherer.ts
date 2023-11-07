/* global FIND_RUINS FIND_DROPPED_RESOURCES FIND_TOMBSTONES
STRUCTURE_STORAGE STRUCTURE_TERMINAL */

import Role from 'role/role';
import utilities from 'utilities';
import {getResourcesIn} from 'utils/store';

declare global {
	interface GathererCreep extends Creep {
		memory: GathererCreepMemory;
		heapMemory: GathererCreepHeapMemory;
	}

	interface GathererCreepMemory extends CreepMemory {
		role: 'gatherer';
		delivering?: boolean;
		targetRoom: string;
		origin: string;
		target: Id<GatherTarget>;
	}

	interface GathererCreepHeapMemory extends CreepHeapMemory {
	}
}

type GatherTarget = Resource | Ruin | Tombstone | AnyStoreStructure;

interface GatherOption {
	priority: number;
	weight: number;
	target: Id<GatherTarget>;
}

/**
 * Gatherers collect resources from safe sources outside their spawn room.
 *
 * They do no work to "produce" these resources, instead relying on gathered
 * intel about resources left in buildings or ruins.
 * A gatherer will move directly to the target room, choose a target to withdraw
 * from, and return home once full to deposit the gathered resources.
 *
 * Memory structure:
 * - origin: Name of the room the creep originates in.
 * - targetRoom: Name of the room to gather resources in.
 */
export default class GathererRole extends Role {
	/**
	 * Makes this creep behave like a gatherer.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: GathererCreep) {
		if (creep.memory.delivering && creep.store.getUsedCapacity() === 0) {
			creep.memory.delivering = false;
		}

		if (creep.memory.delivering) {
			this.deliverResources(creep);
			return;
		}

		this.gatherResources(creep);
	}

	/**
	 * Makes the creep move into the target room and gather resources.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	gatherResources(creep: GathererCreep) {
		// Switch to delivery mode if storage is full.
		if (creep.store.getFreeCapacity() === 0) {
			creep.memory.delivering = true;
			return;
		}

		if (creep.pos.roomName !== creep.memory.targetRoom) {
			// Move back to spawn room.
			creep.moveToRoom(creep.memory.targetRoom);
			return;
		}

		// Choose a target in the room.
		const target = this.getGatherTarget(creep);
		if (!target) return;

		this.gatherFromTarget(creep, target);
	}

	/**
	 * Chooses a target to gather resources from.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @return {RoomObject}
	 *   An object that has gatherable resources stored.
	 */
	getGatherTarget(creep: GathererCreep) {
		if (creep.memory.target) {
			const target = Game.getObjectById(creep.memory.target);
			if (target) return target;
		}

		// Decide what the most valuable target is.
		const options: GatherOption[] = [];
		this.addResourceOptions(creep, options);
		this.addTombstoneOptions(creep, options);
		this.addStructureOptions(creep, options);
		this.addRuinOptions(creep, options);

		const option = utilities.getBestOption(options);
		if (!option) {
			// @todo If there's no valid target, deliver and/or assign to new room.
			creep.memory.delivering = true;
			return null;
		}

		creep.memory.target = option.target;
		return Game.getObjectById(creep.memory.target);
	}

	/**
	 * Adds gathering options for dropped resources.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {object} options
	 *   List of prioritized options to add targets to.
	 */
	addResourceOptions(creep: GathererCreep, options: GatherOption[]) {
		const resources = creep.room.find(FIND_DROPPED_RESOURCES);
		for (const resource of resources) {
			if (!resource.amount) continue;

			// @todo Resource type should have an influence on scoring.
			options.push({
				priority: resource.amount > 100 ? 3 : 2,
				weight: resource.amount / 1000,
				target: resource.id,
			});
		}
	}

	/**
	 * Adds gathering options for dropped resources.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {object} options
	 *   List of prioritized options to add targets to.
	 */
	addTombstoneOptions(creep: GathererCreep, options: GatherOption[]) {
		const tombs = creep.room.find(FIND_TOMBSTONES);
		for (const tomb of tombs) {
			if (tomb.store.getUsedCapacity() === 0) continue;

			options.push({
				priority: tomb.store.getUsedCapacity() > 100 ? 3 : 2,
				weight: tomb.store.getUsedCapacity() / 1000,
				target: tomb.id,
			});
		}
	}

	/**
	 * Adds gathering options for structures containing resources.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {object} options
	 *   List of prioritized options to add targets to.
	 */
	addStructureOptions(creep: GathererCreep, options: GatherOption[]) {
		for (const structure of creep.room.structures as AnyStoreStructure[]) {
			if (!('store' in structure)) continue;
			if (structure.store.getUsedCapacity() === 0) continue;

			// @todo Ignore our own remote harvest containers.
			// @todo Handle structures with a store that can't be withdrawn from.

			options.push({
				priority: structure.structureType === STRUCTURE_STORAGE || structure.structureType === STRUCTURE_TERMINAL ? 2 : 1,
				weight: structure.store.getUsedCapacity() / 10_000,
				target: structure.id,
			});
		}
	}

	/**
	 * Adds gathering options for ruins.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {object} options
	 *   List of prioritized options to add targets to.
	 */
	addRuinOptions(creep: GathererCreep, options: GatherOption[]) {
		const ruins = creep.room.find(FIND_RUINS);
		for (const ruin of ruins) {
			if (!ruin.store) continue;
			if (ruin.store.getUsedCapacity() === 0) continue;

			options.push({
				priority: 1,
				weight: ruin.store.getUsedCapacity() / 10_000,
				target: ruin.id,
			});
		}
	}

	/**
	 * Gathers resources from the given target.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {RoomObject} target
	 *   An object that has gatherable resources stored.
	 */
	gatherFromTarget(creep: GathererCreep, target: GatherTarget) {
		creep.whenInRange(1, target, () => {
			// @todo If path to target is blocked, remember as invalid target.
			// If everything is blocked, consider sending dismantlers, or not doing
			// anything in the room.

			if ('amount' in target) {
				creep.pickup(target);
				delete creep.memory.target;
				return;
			}

			// @todo Withdraw as many resources as possible.
			// @todo Start with most valuable resources?
			for (const resourceType of getResourcesIn(target.store)) {
				creep.withdraw(target, resourceType);
				break;
			}

			// Decide on a new target next tick after withdrawing.
			delete creep.memory.target;
		});
	}

	/**
	 * Makes the creep return to the spawn room and deliver resources.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	deliverResources(creep: GathererCreep) {
		if (creep.pos.roomName !== creep.memory.origin) {
			// Move back to spawn room.
			creep.moveToRoom(creep.memory.origin);
			return;
		}

		// Choose a resource and deliver it.
		for (const resourceType of getResourcesIn(creep.store)) {
			const amount = creep.store.getUsedCapacity(resourceType);

			const target = creep.room.getBestStorageTarget(amount, resourceType);
			if (!target) break;

			creep.whenInRange(1, target, () => {
				creep.transfer(target, resourceType);
			});
			break;
		}
	}
}
