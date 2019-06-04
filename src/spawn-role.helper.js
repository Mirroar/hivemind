'use strict';

/* global */

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
				role: 'helper',
				roomName: room.name,
			});
		}
	}
};
