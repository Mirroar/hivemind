'use strict';

/* global MOVE */

const SpawnRole = require('./spawn-role');

module.exports = class ScoutSpawnRole extends SpawnRole {
	/**
	 * Adds scout spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		const roomScouts = _.filter(Game.creepsByRole.scout, creep => creep.memory.origin === room.name);
		if (_.size(roomScouts) > 0 || !room.needsScout()) return;

		options.push({
			priority: 1,
			weight: 0,
		});
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
		return [MOVE];
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
		return {origin: room.name};
	}
};
