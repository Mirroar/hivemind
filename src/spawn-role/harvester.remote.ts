/* global MOVE WORK CARRY RESOURCE_ENERGY */

import SpawnRole from 'spawn-role/spawn-role';
import {encodePosition, decodePosition} from 'utils/serialization';
import {getRoomIntel} from 'room-intel';

export default class RemoteHarvesterSpawnRole extends SpawnRole {
	/**
	 * Adds remote harvester spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		const harvestPositions = room.getRemoteHarvestSourcePositions();
		for (const pos of harvestPositions) {
			const targetPos = encodePosition(pos);
			const operation = Game.operationsByType.mining['mine:' + pos.roomName];

			// Don't spawn if enemies are in the room.
			if (!operation || operation.isUnderAttack() || operation.needsDismantler(targetPos)) continue;

			// Don't spawn if there is no full path.
			const paths = operation.getPaths();
			const path = paths[targetPos];
			const travelTime = path && path.travelTime;
			if (!travelTime) continue;

			const harvesters = _.filter(
				Game.creepsByRole['harvester.remote'] || {},
				(creep: RemoteHarvesterCreep) => {
					// @todo Instead of filtering for every room, this could be grouped once per tick.
					if (creep.memory.source !== targetPos) return false;

					if (creep.spawning) return true;
					if (creep.ticksToLive > travelTime || creep.ticksToLive > 500) return true;

					return false;
				},
			);

			// Allow spawning multiple harvesters if more work parts are needed,
			// but no more than available spaces around the source.
			const roomIntel = getRoomIntel(pos.roomName);
			let freeSpots = 1;
			for (const source of roomIntel.getSourcePositions()) {
				if (source.x === pos.x && source.y === pos.y) freeSpots = source.free || 1;
			}

			if (harvesters.length >= freeSpots) continue;
			const workParts = _.sum(harvesters, creep => creep.getActiveBodyparts(WORK));
			if (workParts >= operation.getHarvesterSize(targetPos)) continue;

			options.push({
				priority: 3,
				weight: 1,
				targetPos,
				// @todo Consider established when roads are fully built.
				isEstablished: operation.hasContainer(targetPos),
				// Use less work parts if room is not reserved yet.
				size: operation.getHarvesterSize(targetPos),
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
	getCreepBody(room, option) {
		// @todo Also use high number of work parts if road still needs to be built.
		// @todo Use calculated max size like normal harvesters when established.
		// Use less move parts if a road has already been established.
		const bodyWeights = option.isEstablished ? {[MOVE]: 0.35, [WORK]: 0.65} : {[MOVE]: 0.5, [WORK]: 0.5, [CARRY]: 0.1};

		return this.generateCreepBodyFromWeights(
			bodyWeights,
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
			{[WORK]: option.size},
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
			source: option.targetPos,
			operation: 'mine:' + decodePosition(option.targetPos).roomName,
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
		const operationName = 'mine:' + decodePosition(option.targetPos).roomName;
		const operation = Game.operations[operationName];
		if (!operation) return;

		operation.addResourceCost(this.calculateBodyCost(body), RESOURCE_ENERGY);
	}
}
