'use strict';

/* global FIND_MY_CONSTRUCTION_SITES */

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
		let maxWorkParts = 5;
		if (room.controller.level > 2) {
			maxWorkParts += 5;
		}

		// There are a lot of ramparts in planned rooms, spawn builders appropriately.
		// @todo Only if they are not fully built, of course.
		if (room.roomPlanner && room.roomPlanner.memory.locations && room.controller.level >= 4) {
			maxWorkParts += _.size(room.roomPlanner.memory.locations.rampart) / 10;
		}

		// Add more builders if we have a lot of energy to spare.
		if (room.storage && room.storage.store.energy > 400000) {
			maxWorkParts *= 2;
		}
		else if (room.storage && room.storage.store.energy > 200000) {
			maxWorkParts *= 1.5;
		}

		// Add more builders if we're moving a spawn.
		if (room.memory.roomPlanner && room.memory.roomPlanner.hasMisplacedSpawn) {
			maxWorkParts *= 1.5;
		}

		if (room.controller.level <= 3) {
			if (room.find(FIND_MY_CONSTRUCTION_SITES).length === 0) {
				// There isn't really much to repair before RCL 4, so don't spawn
				// new builders when there's nothing to build.
				maxWorkParts = 0;
			}
		}
		else {
			// Spawn more builders depending on total size of current construction sites.
			// @todo Use hitpoints of construction sites vs number of work parts as a guide.
			maxWorkParts += room.find(FIND_MY_CONSTRUCTION_SITES).length / 2;
		}

		let builderSize = null;
		if (room.isEvacuating()) {
			// Just spawn a small builder for keeping roads intact.
			maxWorkParts = 1;
			builderSize = 3;
		}

		let numWorkParts = 0;
		_.each(room.creepsByRole.builder, creep => {
			numWorkParts += creep.memory.body.work || 0;
		});

		if (numWorkParts < maxWorkParts) {
			options.push({
				priority: 3,
				weight: 0.5,
				role: 'builder',
				size: builderSize,
			});
		}
	}
};
