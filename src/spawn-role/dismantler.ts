/* global MOVE WORK */

import BodyBuilder from 'creep/body-builder';
import SpawnRole from 'spawn-role/spawn-role';
import {MOVEMENT_MODE_ROAD} from 'creep/body-builder';

interface DismantlerSpawnOption extends SpawnOption {
	targetRoom?: string;
	operation?: string;
	source?: string;
}

export default class DismantlerSpawnRole extends SpawnRole {
	/**
	 * Adds dismantler spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): DismantlerSpawnOption[] {
		return this.cacheEmptySpawnOptionsFor(room, 100, () => {
			const options: DismantlerSpawnOption[] = [];
			this.addManualDismantlers(room, options);
			this.addRoomPlannerDismantlers(room, options);
			this.addOperationDismantlers(room, options);

			return options;
		});
	}

	/**
	 * Adds dismantler spawn options for explicit orders.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	addManualDismantlers(room: Room, options: DismantlerSpawnOption[]) {
		// @todo Move from flag based to something the AI can control.
		const flags = _.filter(Game.flags, flag => flag.name.startsWith('Dismantle:' + room.name));
		if (flags.length === 0) return;

		// @todo Check if there is enough dismantlers per room with flags in it.
		const flag = flags[0];
		const dismantlerCount = _.filter(Game.creepsByRole.dismantler || [], (creep: DismantlerCreep) => creep.memory.targetRoom === flag.pos.roomName && creep.memory.sourceRoom === room.name).length;

		if (dismantlerCount < flags.length) {
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
	addRoomPlannerDismantlers(room: Room, options: DismantlerSpawnOption[]) {
		if (room.isEvacuating()) return;
		if (!room.roomManager.needsDismantling()) return;

		const dismantlerCount = _.filter(room.creepsByRole.dismantler || [], (creep: DismantlerCreep) => creep.memory.targetRoom === room.name && creep.memory.sourceRoom === room.name).length;
		if (dismantlerCount > 0) return;

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
	addOperationDismantlers(room: Room, options: DismantlerSpawnOption[]) {
		const operations = _.filter(Game.operationsByType.mining, o => o.needsDismantler());
		_.each(operations, operation => {
			const locations = operation.getMiningLocationsByRoom()[room.name];
			if (!locations || locations.length === 0) return;

			for (const sourceLocation of locations) {
				if (!operation.needsDismantler(sourceLocation)) continue;

				const dismantlerCount = _.filter(Game.creepsByRole.dismantler || [], (creep: DismantlerCreep) => creep.memory.source === sourceLocation).length;
				if (dismantlerCount > 0) continue;

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
	getCreepBody(room: Room): BodyPartConstant[] {
		return (new BodyBuilder())
			.setWeights({[WORK]: 1})
			.setMovementMode(MOVEMENT_MODE_ROAD)
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
	getCreepMemory(room: Room, option: DismantlerSpawnOption): DismantlerCreepMemory {
		if (option.operation) {
			return {
				role: 'dismantler',
				operation: option.operation,
				source: option.source,
			};
		}

		return {
			role: 'dismantler',
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
	getCreepBoosts(room: Room, option: DismantlerSpawnOption, body: BodyPartConstant[]): Record<string, ResourceConstant> {
		return this.generateCreepBoosts(room, body, WORK, 'dismantle');
	}
}
