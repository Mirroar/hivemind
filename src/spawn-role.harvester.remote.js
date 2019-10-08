'use strict';

/* global MOVE WORK CARRY */

const utilities = require('./utilities');
const SpawnRole = require('./spawn-role');
const stats = require('./stats');

module.exports = class RemoteHarvesterSpawnRole extends SpawnRole {
	/**
	 * Adds remote harvester spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		if (!room.memory.remoteHarvesting) return;

		const storagePos = utilities.encodePosition(room.storage ? room.storage.pos : room.controller.pos);
		const harvestPositions = room.getRemoteHarvestSourcePositions();
		for (const pos of harvestPositions) {
			utilities.precalculatePaths(room, pos);
			const targetPos = utilities.encodePosition(pos);
			if (!room.memory.remoteHarvesting[targetPos]) continue;

			const harvestMemory = room.memory.remoteHarvesting[targetPos];
			const cachedPathLength = harvestMemory.cachedPath && harvestMemory.cachedPath.path && harvestMemory.cachedPath.path.length;
			const travelTimeSpawn = harvestMemory.travelTime || cachedPathLength;
			const isEstablished = harvestMemory.revenue > 0;

			const harvesters = _.filter(
				Game.creepsByRole['harvester.remote'] || {},
				creep => {
					// @todo Instead of filtering for every room, this could be grouped once per tick.
					if (creep.memory.storage !== storagePos || creep.memory.source !== targetPos) return false;

					if (creep.spawning) return true;
					if (!travelTimeSpawn) return true;
					if (creep.ticksToLive > travelTimeSpawn || creep.ticksToLive > 500) return true;

					return false;
				}
			);
			harvestMemory.harvesters = _.map(harvesters, 'id');

			if (_.size(harvesters) > 0) continue;

			options.push({
				priority: 3,
				weight: 1,
				targetPos,
				isEstablished,
				// Use less work parts if room is not reserved yet.
				size: Game.rooms[pos.roomName] && Game.rooms[pos.roomName].isMine(true) ? 6 : 3,
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
		const bodyWeights = option.isEstablished ? {[MOVE]: 0.35, [WORK]: 0.55, [CARRY]: 0.1} : {[MOVE]: 0.5, [WORK]: 0.2, [CARRY]: 0.3};

		return this.generateCreepBodyFromWeights(
			bodyWeights,
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
			{[WORK]: option.size}
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
			storage: utilities.encodePosition(room.storage ? room.storage.pos : room.controller.pos),
			source: option.targetPos,
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
		const position = option.targetPos;
		if (!position) return;

		stats.addRemoteHarvestCost(room.name, position, this.calculateBodyCost(body));
	}
};
