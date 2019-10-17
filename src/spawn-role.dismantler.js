'use strict';

/* global MOVE WORK */

const SpawnRole = require('./spawn-role');

module.exports = class DismantlerSpawnRole extends SpawnRole {
	/**
	 * Adds dismantler spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		this.addManualDismantlers(room, options);
		this.addRoomPlannerDismantlers(room, options);
	}

	/**
	 * Adds dismantler spawn options for explicit orders.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	addManualDismantlers(room, options) {
		// @todo Move from flag based to something the AI can control.
		const flags = _.filter(Game.flags, flag => flag.name.startsWith('Dismantle:' + room.name));
		if (flags.length === 0) return;

		// @todo Check if there is enough dismantlers per room with flags in it.
		const flag = flags[0];
		const numDismantlers = _.filter(Game.creepsByRole.dismantler || [], creep => creep.memory.targetRoom === flag.pos.roomName && creep.memory.sourceRoom === room.name).length;

		if (numDismantlers < flags.length) {
			options.push({
				priority: 4,
				weight: 0,
				targetRoom: flag.pos.roomName,
			});
		}
	}

	/**
	 * Adds dismantler spawn options for room planner.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	addRoomPlannerDismantlers(room, options) {
		if (room.isEvacuating()) return;
		if (!room.roomManager.needsDismantling()) return;

		const numDismantlers = _.filter(room.creepsByRole.dismantler || [], creep => creep.memory.targetRoom === room.name && creep.memory.sourceRoom === room.name).length;

		if (numDismantlers < 1) {
			options.push({
				priority: 3,
				weight: 0,
				targetRoom: room.name,
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
			{[MOVE]: 0.35, [WORK]: 0.65},
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
	getCreepMemory(room, option) {
		return {
			sourceRoom: room.name,
			targetRoom: option.targetRoom,
		};
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
		return this.generateCreepBoosts(room, body, WORK, 'dismantle');
	}
};
