/* global MOVE CLAIM BODYPART_COST CONTROLLER_RESERVE_MAX RESOURCE_ENERGY */

declare global {
	interface RoomMemory {
		lastClaim?: any,
	}
}

import utilities from 'utilities';
import SpawnRole from 'spawn-role/spawn-role';

export default class ClaimerSpawnRole extends SpawnRole {
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
			const operation = Game.operationsByType.mining['mine:' + pos.roomName];

			// Don't spawn if enemies are in the room.
			// @todo Or in any room on the route, actually.
			if (!operation || operation.isUnderAttack() || operation.needsDismantler()) continue;

			const claimers = _.filter(Game.creepsByRole.claimer || {}, (creep: ClaimerCreep) => creep.memory.mission === 'reserve' && creep.memory.target === utilities.encodePosition(pos));
			if (_.size(claimers) > 0) continue;

			const roomMemory = Memory.rooms[pos.roomName];
			if (
				roomMemory &&
				roomMemory.lastClaim &&
				roomMemory.lastClaim.time + roomMemory.lastClaim.value - Game.time > CONTROLLER_RESERVE_MAX * 0.5
			) continue;

			// Don't spawn if enemies are in the room.
			// @todo Or in any room on the route, actually.
			if (roomMemory && roomMemory.enemies && !roomMemory.enemies.safe) continue;

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
	getCreepMemory(room, option): ClaimerCreepMemory {
		return {
			role: 'claimer',
			target: utilities.encodePosition(option.targetPos),
			mission: 'reserve',
			// The creep might not belong to a mining operation, but there's no harm
			// if the operation doesn't exist.
			operation: 'mine:' + option.targetPos.roomName,
		};
	}

	/**
	 * Act when a creep belonging to this spawn role is successfully spawning.
	 *
	 * @param {Room} room
	 *   The room the creep is spawned in.
	 * @param {Object} option
	 *   The spawn option which caused the spawning.
	 * @param {string[]} body
	 *   The body generated for this creep.
	 * @param {string} name
	 *   The name of the new creep.
	 */
	onSpawn(room, option, body) {
		const operationName = 'mine:' + option.targetPos.roomName;
		const operation = Game.operations[operationName];
		if (!operation) return;

		operation.addResourceCost(this.calculateBodyCost(body), RESOURCE_ENERGY);
	}
};
