/* global MOVE CARRY */

import BodyBuilder, {MOVEMENT_MODE_ROAD} from 'creep/body-builder';
import SpawnRole from 'spawn-role/spawn-role';

export default class HelperSpawnRole extends SpawnRole {
	/**
	 * Adds helper spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): SpawnOption[] {
		return this.cacheEmptySpawnOptionsFor(room, 10, () => {
			const maxHelpers = 1;
			const helperCount = _.size(room.creepsByRole.helper);

			// Make sure we actually need helpers.
			if (helperCount < maxHelpers && room.boostManager.getBoostLabs().length > 0) {
				return [{
					priority: 5,
					weight: 1.1,
				}];
			}

			return [];
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
		// @todo Calculate size limit.
		// We want to be able to spawn the helper quickly, but it needs to be
		// able to carry enough boosts and energy to work quickly.

		return (new BodyBuilder())
			.setWeights({[CARRY]: 1})
			.setPartLimit(CARRY, 12)
			.setMovementMode(MOVEMENT_MODE_ROAD)
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
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
		return {
			singleRoom: room.name,
			operation: 'room:' + room.name,
		};
	}
}
