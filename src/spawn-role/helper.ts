/* global MOVE CARRY */

import SpawnRole from 'spawn-role/spawn-role';

export default class HelperSpawnRole extends SpawnRole {
	/**
	 * Adds helper spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): SpawnOption[] {
		if (!room.boostManager?.needsSpawning()) return [];

		return [{
			priority: 4,
			weight: 1,
		}];
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
	getCreepBody(): BodyPartConstant[] {
		return [MOVE, MOVE, CARRY, CARRY, CARRY, CARRY];
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
	getCreepMemory(room: Room): CreepMemory {
		return {
			singleRoom: room.name,
			operation: 'room:' + room.name,
		};
	}
}
