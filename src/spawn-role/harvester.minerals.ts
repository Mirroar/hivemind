/* global FIND_MINERALS FIND_STRUCTURES STRUCTURE_EXTRACTOR MOVE WORK CARRY */

import SpawnRole from 'spawn-role/spawn-role';

interface MineralHarvesterSpawnOption extends SpawnOption {
	source: Id<Mineral>;
}

export default class MineralHarvesterSpawnRole extends SpawnRole {
	/**
	 * Adds mineral harvester spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): MineralHarvesterSpawnOption[] {
		// Stop harvesting if we can't really store any more minerals.
		if (room.isEvacuating()) return [];
		if (room.getEffectiveAvailableEnergy() < 5000) return [];

		// Find mineral sources with an extractor.
		// @todo This could be done on script startup and partially kept in room memory.
		const minerals = room.find(FIND_MINERALS, {
			filter: mineral => {
				const extractors = mineral.mineralAmount > 0 ? mineral.pos.findInRange(FIND_STRUCTURES, 0, {
					filter: structure => structure.structureType === STRUCTURE_EXTRACTOR && structure.isOperational(),
				}) : [];
				return extractors.length > 0;
			},
		});

		const options: MineralHarvesterSpawnOption[] = [];
		for (const mineral of minerals) {
			if (!mineral.getNearbyContainer()) continue;
			if (room.isFullOnMinerals() && mineral.mineralType !== RESOURCE_THORIUM) return [];

			const mineralHarvesters = _.filter(mineral.harvesters, creep => creep.spawning || creep.ticksToLive > this.getCreepBody(room).length * CREEP_SPAWN_TIME);
			const maxHarvesters = room.isStripmine() ? Math.min(3, mineral.getNumHarvestSpots()) : 1;
			if (_.size(mineralHarvesters) >= maxHarvesters) continue;

			let minAmount = 0;
			if (!room.isStripmine() && mineral.mineralType === RESOURCE_THORIUM) {
				minAmount = 500;
			}
			if (mineral.mineralAmount <= minAmount) continue;

			options.push({
				priority: room.isStripmine() ? 4 : 3,
				weight: 0.2,
				source: mineral.id,
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
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.35, [WORK]: 0.6, [CARRY]: 0.05},
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
	getCreepMemory(room: Room, option: MineralHarvesterSpawnOption): HarvesterCreepMemory {
		return {
			role: 'harvester',
			singleRoom: room.name,
			fixedMineralSource: option.source,
			operation: 'room:' + room.name,
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
	getCreepBoosts(room: Room, option: MineralHarvesterSpawnOption, body: BodyPartConstant[]): Record<string, ResourceConstant> {
		const mineral = Game.getObjectById(option.source);
		if (mineral.mineralAmount < 2000) return {};

		return this.generateCreepBoosts(room, body, WORK, 'harvest');
	}
}
