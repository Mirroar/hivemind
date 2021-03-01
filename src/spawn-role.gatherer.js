'use strict';

/* global MOVE CARRY */

const SpawnRole = require('./spawn-role');

module.exports = class GathererSpawnRole extends SpawnRole {
	/**
	 * Adds gatherer spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		if (!room.storage) return;

		_.each(room.memory.abandonedResources, (resources, roomName) => {
			const numGatherers = _.filter(Game.creepsByRole.gatherer || [], creep => creep.memory.targetRoom === roomName && creep.memory.origin === room.name).length;
			// @todo Allow more gatherers at low priority if a lot of resources need
			// gathering.
			if (numGatherers > 0) return;

			options.push({
				priority: 2,
				weight: 0.8,
				targetRoom: roomName,
			});
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
			this.getBodyWeights(),
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
		);
	}

	/**
	 * Determine body weights for haulers.
	 *
	 * @return {object}
	 *   An object containing body part weights, keyed by type.
	 */
	getBodyWeights() {
		return {[MOVE]: 0.5, [CARRY]: 0.5};
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
	getCreepMemory(room, option) {
		return {
			origin: room.name,
			targetRoom: option.targetRoom,
		};
	}
};
