'use strict';

/* global FIND_MY_CONSTRUCTION_SITES MOVE WORK CARRY */

const SpawnRole = require('./spawn-role');

module.exports = class BuilderSpawnRole extends SpawnRole {
	/**
	 * Adds builder spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		const maxWorkParts = this.getNeededWorkParts(room);

		let numWorkParts = 0;
		_.each(room.creepsByRole.builder, creep => {
			numWorkParts += creep.memory.body.work || 0;
		});

		if (numWorkParts < maxWorkParts) {
			options.push({
				priority: 3,
				weight: 0.5,
				size: room.isEvacuating() ? 3 : null,
			});
		}
	}

	/**
	 * Determine how many work parts we need on builders in this room.
	 *
	 * @param {Room} room
	 *   The room to check.
	 *
	 * @return {number}
	 *   The number of work parts needed.
	 */
	getNeededWorkParts(room) {
		if (room.isEvacuating()) {
			// Just spawn a small builder for keeping roads intact.
			return 1;
		}

		if (room.controller.level <= 3 && room.find(FIND_MY_CONSTRUCTION_SITES).length === 0) {
			// There isn't really much to repair before RCL 4, so don't spawn
			// new builders when there's nothing to build.
			return 1;
		}

		let maxWorkParts = 5;
		if (room.controller.level > 2) {
			maxWorkParts += 5;
		}

		// There are a lot of ramparts in planned rooms, spawn builders appropriately.
		// @todo Only if they are not fully built, of course.
		if (room.roomPlanner && room.controller.level >= 4) {
			maxWorkParts += _.size(room.roomPlanner.getLocations('rampart')) / 10;
		}

		// Add more builders if we have a lot of energy to spare.
		const availableEnergy = room.getStoredEnergy();
		if (availableEnergy > 400000) {
			maxWorkParts *= 2;
		}
		else if (availableEnergy > 200000) {
			maxWorkParts *= 1.5;
		}

		// Add more builders if we're moving a spawn.
		if (room.roomManager && room.roomManager.hasMisplacedSpawn()) {
			maxWorkParts *= 2;
		}

		if (room.controller.level > 3) {
			// Spawn more builders depending on total size of current construction sites.
			// @todo Use hitpoints of construction sites vs number of work parts as a guide.
			maxWorkParts += room.find(FIND_MY_CONSTRUCTION_SITES).length / 2;
		}

		return maxWorkParts;
	}

	/**
	 * Gets the body of a creep to be spawned.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object} option
	 *   The spawn option for which to generate the body.
	 *
	 * @return {string[]}
	 *   A list of body parts the new creep should consist of.
	 */
	getCreepBody(room, option) {
		const maxParts = option.size && {[WORK]: option.size};

		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.35, [WORK]: 0.35, [CARRY]: 0.3},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
			maxParts
		);
	}

	/**
	 * Gets memory for a new creep.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object} option
	 *   The spawn option for which to generate the body.
	 *
	 * @return {Object}
	 *   The boost compound to use keyed by body part type.
	 */
	getCreepMemory(room) {
		return {
			singleRoom: room.name,
			operation: 'room:' + room.name,
		};
	}

	/**
	 * Gets which boosts to use on a new creep.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object} option
	 *   The spawn option for which to generate the body.
	 * @param {string[]} body
	 *   The body generated for this creep.
	 *
	 * @return {Object}
	 *   The boost compound to use keyed by body part type.
	 */
	getCreepBoosts(room, option, body) {
		return this.generateCreepBoosts(room, body, WORK, 'repair');
	}
};
