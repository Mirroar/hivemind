'use strict';

/* global utilities MOVE CLAIM BODYPART_COST CONTROLLER_RESERVE_MAX */

const SpawnRole = require('./spawn-role');

module.exports = class ClaimerSpawnRole extends SpawnRole {
	/**
	 * Adds claimer spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		// Only spawn claimers if they can have 2 or more claim parts.
		if (room.energyCapacityAvailable < 2 * (BODYPART_COST[CLAIM] + BODYPART_COST[MOVE])) return;

		const reservePositions = room.getRemoteReservePositions();
		for (const pos of reservePositions) {
			// Cache path when possible.
			utilities.precalculatePaths(room, pos);

			const claimers = _.filter(Game.creepsByRole.claimer || {}, creep => creep.memory.mission === 'reserve' && creep.memory.target === utilities.encodePosition(pos));
			if (_.size(claimers) > 0) continue;

			const roomMemory = Memory.rooms[pos.roomName];
			if (
				roomMemory &&
				roomMemory.lastClaim &&
				roomMemory.lastClaim.time + roomMemory.lastClaim.value - Game.time > CONTROLLER_RESERVE_MAX * 0.5
			) continue;

			options.push({
				priority: 3,
				weight: 0,
				targetPos: pos,
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
	getCreepBody(room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [CLAIM]: 0.5},
			room.energyCapacityAvailable,
			{[CLAIM]: 5},
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
		return {
			target: utilities.encodePosition(option.targetPos),
			'reserve',
		};
	}
};
