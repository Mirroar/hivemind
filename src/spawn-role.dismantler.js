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
		if (room.isEvacuating()) return;

		const flags = _.filter(Game.flags, flag => flag.name.startsWith('Dismantle:' + room.name));
		if (flags.length > 0) {
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

		if (room.roomPlanner && room.roomPlanner.needsDismantling()) {
			// @todo this.roomPlanner will not be available until spawn management is moved to run after room logic.
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
	}
};
