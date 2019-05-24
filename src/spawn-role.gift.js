'use strict';

const SpawnRole = require('./spawn-role');

module.exports = class GiftSpawnRole extends SpawnRole {
	/**
	 * Adds gift spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		// @todo This is unlikely to happen exaclty when a spawn is idle.
		if (Game.time % 123 !== 67) return;
		if (!this.storage || this.getFreeStorage() > this.getStorageLimit() * 0.05) return;

		options.push({
			priority: 4,
			weight: 0,
			role: 'gift',
		});
	}
};
