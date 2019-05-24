'use strict';

/* global hivemind FIND_MY_CONSTRUCTION_SITES CONTROLLER_DOWNGRADE hivemind */

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
		const numUpgraders = _.size(_.filter(room.creepsByRole.upgrader, creep => !creep.ticksToLive || creep.ticksToLive > creep.body.length * 3));
		let maxUpgraders = 0;

		if (room.controller.level <= 3) {
			const numSources = _.size(room.sources);
			maxUpgraders = 1 + numSources + Math.floor(room.getStoredEnergy() / 2000);
			maxUpgraders = Math.min(maxUpgraders, 5);
		}
		else if (room.controller.level === 8) {
			maxUpgraders = 1;
			if (room.getStoredEnergy() < 50000) {
				maxUpgraders = 0;
			}
		}
		else if (room.getStoredEnergy() < 100000) {
			maxUpgraders = 0;
		}
		else if (room.getStoredEnergy() < 300000) {
			maxUpgraders = 1;
		}
		else if (room.getStoredEnergy() < 500000) {
			maxUpgraders = 2;
		}
		else {
			// @todo Have maximum depend on number of work parts.
			// @todo Make sure enough energy is brought by.
			maxUpgraders = 3;
		}

		if (room.isEvacuating()) maxUpgraders = 0;

		if (!room.storage && !room.terminal && room.find(FIND_MY_CONSTRUCTION_SITES).length > 0) {
			// Do not spawn upgraders when builders and spawns will need most of
			// our energy.
			maxUpgraders = 0;
		}

		if (maxUpgraders === 0 && room.controller.ticksToDowngrade < CONTROLLER_DOWNGRADE[room.controller.level] * 0.5) {
			hivemind.log('creeps', room.name).info('trying to spawn upgrader because controller is close to downgrading', room.controller.ticksToDowngrade, '/', CONTROLLER_DOWNGRADE[room.controller.level]);
			// Even if no upgraders are needed, at least create one when the controller is getting close to being downgraded.
			maxUpgraders = 1;
		}

		if (numUpgraders < maxUpgraders) {
			options.push({
				priority: 3,
				weight: 1,
				role: 'upgrader',
			});
		}
	}
};
