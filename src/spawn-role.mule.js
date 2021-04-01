'use strict';

/* global hivemind MOVE CARRY */

const SpawnRole = require('./spawn-role');
const TradeRoute = require('./trade-route');

module.exports = class MuleSpawnRole extends SpawnRole {
	/**
	 * Adds mule spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		if (!room.storage) return;

		_.each(Memory.tradeRoutes, (mem, routeName) => {
			const tradeRoute = new TradeRoute(routeName);
			if (!tradeRoute.isActive()) return;
			if (tradeRoute.getOrigin() !== room.name) return;
			const resourceType = tradeRoute.getResourceType();
			const storedAmount = (room.storage && room.storage.store[resourceType] || 0) + (room.terminal && room.terminal.store[resourceType] || 0);
			if (storedAmount < 1000) return;

			const numMules = _.filter(Game.creepsByRole.mule || [], creep => creep.memory.origin === room.name && creep.memory.route === routeName).length;
			// @todo Allow more mules at low priority if a lot of resources need
			// delivering.
			if (numMules > 0) return;

			options.push({
				priority: 2,
				weight: 1.2,
				routeName,
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
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable) * 0.7,
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
			route: option.routeName,
		};
	}
};
