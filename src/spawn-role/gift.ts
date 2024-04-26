/* global MOVE CARRY */

import BodyBuilder from 'creep/body-builder';
import SpawnRole from 'spawn-role/spawn-role';
import {MOVEMENT_MODE_SLOW} from 'creep/body-builder';

export default class GiftSpawnRole extends SpawnRole {
	/**
	 * Adds gift spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): SpawnOption[] {
		return this.cacheEmptySpawnOptionsFor(room, 300, () => {
			if (room.getEffectiveAvailableEnergy() < 10_000) return [];
			if (!room.storage || room.getFreeStorage() > room.getStorageLimit() * 0.02) return [];

			return [{
				priority: 3,
				weight: 0.5,
			}];
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
	getCreepBody(room: Room): BodyPartConstant[] {
		return (new BodyBuilder())
			.setWeights({[CARRY]: 1})
			.setMovementMode(MOVEMENT_MODE_SLOW)
			.setEnergyLimit(Math.max(room.energyCapacityAvailable * 0.9, Math.min(room.energyAvailable, room.energyCapacityAvailable)))
			.build();
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
		return {origin: room.name};
	}
}
