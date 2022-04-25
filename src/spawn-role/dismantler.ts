/* global MOVE WORK */

import SpawnRole from 'spawn-role/spawn-role';

export default class DismantlerSpawnRole extends SpawnRole {
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
		this.addOperationDismantlers(room, options);
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
	addRoomPlannerDismantlers(room: Room, options) {
		if (room.isEvacuating()) return;
		if (!room.roomManager.needsDismantling()) return;

		const numDismantlers = _.filter(room.creepsByRole.dismantler || [], creep => creep.memory.targetRoom === room.name && creep.memory.sourceRoom === room.name).length;
		if (numDismantlers > 0) return;

		options.push({
			priority: 3,
			weight: 0,
			targetRoom: room.name,
		});
	}

	/**
	 * Adds dismantler spawn options for (remote mine) operations.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	addOperationDismantlers(room, options) {
		const operations = _.filter(Game.operationsByType.mining, o => o.needsDismantler());
		_.each(operations, operation => {
			const locations = operation.getMiningLocationsByRoom()[room.name];
			if (!locations || locations.length === 0) return;

			for (const sourceLocation of locations) {
				if (!operation.needsDismantler(sourceLocation)) continue;

				const numDismantlers = _.filter(Game.creepsByRole.dismantler || [], creep => creep.memory.source === sourceLocation).length;
				if (numDismantlers > 0) continue;

				options.push({
					priority: 3,
					weight: 0,
					operation: operation.name,
					source: sourceLocation,
				});
			}
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
			{[MOVE]: 0.35, [WORK]: 0.65},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
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
		if (option.operation) {
			return {
				operation: option.operation,
				source: option.source,
			};
		}

		return {
			sourceRoom: room.name,
			targetRoom: option.targetRoom,
			operation: 'room:' + room.name,
			singleRoom: option.targetRoom === room.name ? room.name : null,
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
}
