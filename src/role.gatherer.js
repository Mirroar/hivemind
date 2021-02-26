'use strict';

/* global FIND_STRUCTURES FIND_RUINS FIND_SYMBOL_CONTAINERS
FIND_DROPPED_RESOURCES */

const Role = require('./role');

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
module.exports = class GathererRole extends Role {
	/**
	 * Makes this creep behave like a gatherer.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep) {
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
	gatherResources(creep) {
		if (creep.pos.roomName !== creep.memory.targetRoom) {
			// Move back to spawn room.
			creep.moveToRoom(creep.memory.targetRoom);
			return;
		}

		// Choose a target in the room.
		const target = this.getGatherTarget(creep);
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
	getGatherTarget(creep) {
		if (this.memory.target) {
			const target = Game.getObjectById(this.memory.target);
			if (target) return target;
		}

		const containers = creep.room.find(FIND_SYMBOL_CONTAINERS);
		const resources = creep.room.find(FIND_DROPPED_RESOURCES);
		const structures = creep.room.find(FIND_STRUCTURES);
		const ruins = creep.room.find(FIND_RUINS);

		// @todo Decide what the most valuable target is.
		for (const container of containers) {
			// @todo
			if (container.store && container.store.getUsedCapacity(container.resourceType) > 0) {
				this.memory.target = container.id;
				return container;
			}
		}

		for (const resource of resources) {
			// @todo
			if (resource.amount) {
				this.memory.target = resource.id;
				return resource;
			}
		}

		for (const structure of structures) {
			// @todo
			if (structure.store && structure.store.getUsedCapacity() > 0) {
				this.memory.target = structure.id;
				return structure;
			}
		}

		for (const ruin of ruins) {
			// @todo
			if (ruin.store && ruin.store.getUsedCapacity() > 0) {
				this.memory.target = ruin.id;
				return ruin;
			}
		}

		// @todo If there's no valid target, deliver and/or assign to new room.
		this.memory.delivering = true;
	}

	/**
	 * Gathers resources from the given target.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {RoomObject} target
	 *   An object that has gatherable resources stored.
	 */
	gatherFromTarget(creep, target) {
		if (creep.pos.getRangeTo(target) > 1) {
			creep.moveToRange(target, 1);
			return;
		}

		if (target.amount) {
			creep.pickup(target);
		}

		// @todo Withdraw as many resources as possible.
		// @todo Start with most valuable resources?
		_.each(target.store, (amount, resourceType) => {
			if (!amount || amount === 0) return;
			creep.withdraw(target, resourceType);
		});

		// Switch to delivery mode if storage is full.
		if (creep.store.getFreeCapacity() === 0) {
			this.memory.delivering = true;
		}
	}

	/**
	 * Makes the creep return to the spawn room and deliver resources.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	deliverResources(creep) {
		if (creep.pos.roomName !== creep.memory.origin) {
			// Move back to spawn room.
			creep.moveToRoom(creep.memory.origin);
			return;
		}

		// Choose a resource and deliver it.
		_.each(creep.store, (amount, resourceType) => {
			if (!amount || amount === 0) return;

			const target = creep.room.getBestStorageTarget(amount, resourceType);
			if (!target) return;

			if (creep.pos.getRangeTo(target) > 1) {
				creep.moveToRange(target, 1);
				return false;
			}

			creep.transfer(target, resourceType);
		});

		if (creep.store.getUsedCapacity() === 0) {
			this.memory.delivering = false;
		}
	}
};
