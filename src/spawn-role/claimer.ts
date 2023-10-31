/* global MOVE CLAIM BODYPART_COST CONTROLLER_RESERVE_MAX RESOURCE_ENERGY */

import BodyBuilder from 'creep/body-builder';
import settings from 'settings-manager';
import SpawnRole from 'spawn-role/spawn-role';
import {encodePosition} from 'utils/serialization';

interface ClaimerSpawnOption extends SpawnOption {
	targetPos: RoomPosition;
}

export default class ClaimerSpawnRole extends SpawnRole {
	/**
	 * Adds claimer spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): ClaimerSpawnOption[] {
		// Only spawn claimers if they can have 2 or more claim parts.
		if (room.energyCapacityAvailable < 2 * (BODYPART_COST[CLAIM] + BODYPART_COST[MOVE])) return [];
		if (settings.get('newRemoteMiningRoomFilter') && settings.get('newRemoteMiningRoomFilter')(room.name)) return [];

		const options: ClaimerSpawnOption[] = [];
		const reservePositions = room.getRemoteReservePositions();
		let offset = -1;
		for (const pos of reservePositions) {
			offset++;
			const operation = Game.operationsByType.mining['mine:' + pos.roomName];

			// Don't spawn if enemies are in the room.
			// @todo Or in any room on the route, actually.
			if (!operation || operation.needsDismantler()) continue;
			if (operation.isUnderAttack()) {
				const totalEnemyData = operation.getTotalEnemyData();
				const isInvaderCore = totalEnemyData.damage === 0 && totalEnemyData.heal === 0;
				if (!isInvaderCore) continue;
			}

			const pathLength = operation.getPaths()?.[encodePosition(pos)]?.path.length || 50;
			const claimerSpawnTime = this.getCreepBody(room).length * CREEP_SPAWN_TIME;
			const claimers = _.filter(
				Game.creepsByRole.claimer || {},
				(creep: ClaimerCreep) =>
					creep.memory.mission === 'reserve' && creep.memory.target === encodePosition(pos)
					&& creep.ticksToLive > pathLength + claimerSpawnTime,
			);
			if (_.size(claimers) > 0) continue;

			const roomMemory = Memory.rooms[pos.roomName];
			if (roomMemory?.lastClaim) {
				const remainingReservation = roomMemory.lastClaim.time + roomMemory.lastClaim.value - Game.time;
				if (remainingReservation - claimerSpawnTime - pathLength > CONTROLLER_RESERVE_MAX * 0.5) continue;
			}

			// Don't spawn if enemies are in the room.
			// @todo Or in any room on the route, actually.
			if (roomMemory && roomMemory.enemies && !roomMemory.enemies.safe) continue;

			options.push({
				priority: 3,
				weight: 1 - offset * 0.8,
				targetPos: pos,
			});
		}

		return options;
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
			.setWeights({[CLAIM]: 1})
			.setPartLimit(CLAIM, 5)
			.setEnergyLimit(room.energyCapacityAvailable)
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
	getCreepMemory(room: Room, option: ClaimerSpawnOption): ClaimerCreepMemory {
		return {
			role: 'claimer',
			target: encodePosition(option.targetPos),
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
	onSpawn(room: Room, option: ClaimerSpawnOption, body: BodyPartConstant[]) {
		const operationName = 'mine:' + option.targetPos.roomName;
		const operation = Game.operations[operationName];
		if (!operation) return;

		operation.addResourceCost(this.calculateBodyCost(body), RESOURCE_ENERGY);
	}
}
