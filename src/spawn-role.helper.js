'use strict';

/* global MOVE CARRY */

const SpawnRole = require('./spawn-role');

module.exports = class HelperSpawnRole extends SpawnRole {
	/**
	 * Adds helper spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		if (!room.boostManager) return;

		if (room.boostManager.needsSpawning()) {
			options.push({
				priority: 4,
				weight: 1,
				roomName: room.name,
			});
		}
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
	getCreepBody() {
		return [MOVE, MOVE, CARRY, CARRY, CARRY, CARRY];
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
};
