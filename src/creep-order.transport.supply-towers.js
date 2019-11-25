'use strict';

/* global FIND_STRUCTURES STRUCTURE_TOWER RESOURCE_ENERGY */

const CreepOrder = require('./creep-order');

module.export = class SupplyTowersOrder extends CreepOrder {
	/**
	 * Adds options for supplying towers with energy.
	 *
	 * @param {Creep} creep
	 *   The creep to add order options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getOptions(creep, options) {
		const room = creep.room;
		const targets = room.find(FIND_STRUCTURES, {
			filter: structure => {
				return (structure.structureType === STRUCTURE_TOWER) && structure.energy < structure.energyCapacity * 0.8;
			},
		});

		for (const target of targets) {
			const option = {
				priority: 3,
				weight: (target.energyCapacity - target.energy) / 100, // @todo Also factor in distance.
				object: target,
				resourceType: RESOURCE_ENERGY,
			};

			if (room.memory.enemies && !room.memory.enemies.safe) {
				option.priority++;
			}

			if (target.energy < target.energyCapacity * 0.2) {
				option.priority++;
			}

			option.priority -= room.getCreepsWithOrder('deliver', target.id).length * 2;

			options.push(option);
		}
	}

	/**
	 *
	 */
	run(creep, order) {
		if (!order.delivering && creep.store[RESOURCE_ENERGY] < creep.storeCapacity * 0.8) {
			this.getEnergy(creep, true);
		}

		order.delivering = true;
	}
};
