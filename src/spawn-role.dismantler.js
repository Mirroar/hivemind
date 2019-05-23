'use strict';

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
				role: 'dismantler',
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
		if (!room.roomPlanner) return;
		if (!room.roomPlanner.needsDismantling()) return;

		const numDismantlers = _.filter(room.creepsByRole.dismantler || [], creep => creep.memory.targetRoom === room.name && creep.memory.sourceRoom === room.name).length;

		if (numDismantlers < 1) {
			options.push({
				priority: 3,
				weight: 0,
				role: 'dismantler',
				targetRoom: room.name,
			});
		}
	}
};
