'use strict';

/* global hivemind FIND_MY_CONSTRUCTION_SITES CONTROLLER_DOWNGRADE
MOVE WORK CARRY CONTROLLER_MAX_UPGRADE_PER_TICK */

const SpawnRole = require('./spawn-role');

module.exports = class UpgraderSpawnRole extends SpawnRole {
	/**
	 * Adds upgrader spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		const maxUpgraders = this.getUpgraderAmount(room);
		const numUpgraders = _.size(_.filter(room.creepsByRole.upgrader, creep => !creep.ticksToLive || creep.ticksToLive > creep.body.length * 3));
		if (numUpgraders < maxUpgraders) {
			options.push({
				priority: 3,
				weight: 1,
			});
		}
	}

	/**
	 * Gets number of needed upgraders depending on room needs.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 *
	 * @return {number}
	 *   The requested number of upgraders.
	 */
	getUpgraderAmount(room) {
		const maxUpgraders = this.getBaseUpgraderAmount(room);

		if (maxUpgraders === 0 && room.controller.ticksToDowngrade < CONTROLLER_DOWNGRADE[room.controller.level] * 0.5) {
			hivemind.log('creeps', room.name).info('trying to spawn upgrader because controller is close to downgrading', room.controller.ticksToDowngrade, '/', CONTROLLER_DOWNGRADE[room.controller.level]);
			// Even if no upgraders are needed, at least create one when the controller is getting close to being downgraded.
			return 1;
		}

		return maxUpgraders;
	}

	/**
	 * Gets number of needed upgraders depending on room needs.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 *
	 * @return {number}
	 *   The requested number of upgraders.
	 */
	getBaseUpgraderAmount(room) {
		// Do not spawn upgraders in evacuating rooms.
		if (room.isEvacuating()) return 0;

		// Do not spawn upgraders when builders and spawns will need most of
		// our energy.
		if (!room.storage && !room.terminal && room.find(FIND_MY_CONSTRUCTION_SITES).length > 0) {
			return 0;
		}

		// RCL 8 rooms can't make use of more than 1 upgrader.
		const availableEnergy = room.getStoredEnergy();
		if (room.controller.level === 8) {
			if (availableEnergy < 50000) return 0;
			return 1;
		}

		// Small rooms that don't have a storage yet shouls spawn upgraders depending on available energy.
		if (room.controller.level <= 3) {
			const numSources = _.size(room.sources);
			const maxUpgraders = 1 + numSources + Math.floor(availableEnergy / 2000);
			return Math.min(maxUpgraders, 5);
		}

		// Spawn upgraders depending on stored energy.
		if (availableEnergy < 100000) return 0;
		if (availableEnergy < 300000) return 1;
		if (availableEnergy < 500000) return 2;
		// @todo Have maximum depend on number of work parts.
		// @todo Make sure enough energy is brought by.
		return 3;
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
		let bodyWeights = {[MOVE]: 0.35, [WORK]: 0.3, [CARRY]: 0.35};
		if (room.memory.controllerContainer || room.memory.controllerLink) {
			// If there is easy access to energy, we can save on move an carry parts.
			bodyWeights = {[MOVE]: 0.2, [WORK]: 0.75, [CARRY]: 0.05};
		}

		return this.generateCreepBodyFromWeights(
			bodyWeights,
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
			{[WORK]: CONTROLLER_MAX_UPGRADE_PER_TICK}
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
		return {singleRoom: room.name};
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
		return this.generateCreepBoosts(room, body, WORK, 'upgradeController');
	}
};
