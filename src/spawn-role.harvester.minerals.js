'use strict';

/* global FIND_MINERALS FIND_STRUCTURES STRUCTURE_EXTRACTOR MOVE WORK CARRY */

const SpawnRole = require('./spawn-role');

module.exports = class MineralHarvesterSpawnRole extends SpawnRole {
	/**
	 * Adds mineral harvester spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		// Stop harvesting if we can't really store any more minerals.
		if (room.isFullOnMinerals()) return;
		if (room.isEvacuating()) return;

		// Find mineral sources with an extractor.
		// @todo This could be done on script startup and partially kept in room memory.
		const mineralHarvesters = room.creepsByRole['harvester.minerals'] || {};
		const minerals = room.find(FIND_MINERALS, {
			filter: mineral => {
				const extractors = mineral.pos.findInRange(FIND_STRUCTURES, 1, {
					filter: structure => structure.structureType === STRUCTURE_EXTRACTOR && structure.isOperational(),
				});

				return extractors.length > 0;
			},
		});

		// We assume there is always at most one mineral deposit in a room.
		if (_.size(mineralHarvesters) > 0 || minerals.length === 0 || minerals[0].mineralAmount === 0) return;

		options.push({
			priority: 2,
			source: minerals[0].id,
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
			{[MOVE]: 0.35, [WORK]: 0.6, [CARRY]: 0.05},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)
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
			singleRoom: room.name,
			fixedMineralSource: option.source,
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
		return this.generateCreepBoosts(room, body, WORK, 'harvest');
	}
};
