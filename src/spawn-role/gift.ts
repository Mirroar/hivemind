/* global MOVE CARRY */

import SpawnRole from 'spawn-role/spawn-role';

export default class GiftSpawnRole extends SpawnRole {
	/**
	 * Adds gift spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room: Room, options) {
		// @todo This is unlikely to happen exactly when a spawn is idle.
		if (Game.time % 123 !== 67) return;
		if (room.getStoredEnergy() < 10000) return;
		if (!room.storage || room.getFreeStorage() > room.getStorageLimit() * 0.05) return;

		options.push({
			priority: 3,
			weight: 0.5,
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
	getCreepBody(room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.2, [CARRY]: 0.8},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)
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
		return {origin: room.name};
	}
}
