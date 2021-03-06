'use strict';

/* global ENERGY_REGEN_TIME PWR_REGEN_SOURCE POWER_INFO MOVE WORK CARRY */

const SpawnRole = require('./spawn-role');

module.exports = class HarvesterSpawnRole extends SpawnRole {
	/**
	 * Adds harvester spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		// Stop harvesting if we can't really store any more energy.
		if (room.isFullOnEnergy() && !this.isSmallHarvesterNeeded(room)) return;

		for (const source of room.sources) {
			this.addInitialHarvester(source, options);
			this.addAdditionalHarvesters(source, options);
		}
	}

	/**
	 * Spawns a harvester at every source.
	 *
	 * @param {Source} source
	 *   The source to spawn harvesters for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	addInitialHarvester(source, options) {
		// @todo Spawn bigger harvesters in high level rooms with plenty of energy to save on CPU.
		// @todo Spawn new harvester before previous harvester dies.

		if (source.harvesters.length > 0) return;

		const force = this.isSmallHarvesterNeeded(source.room);
		options.push({
			priority: (force ? 5 : 4),
			weight: 1,
			source: source.id,
			preferClosestSpawn: source.pos,
			size: this.getMaxWorkParts(source),
			force,
		});
	}

	/**
	 * Spawns additional harvesters when it improves productivity.
	 *
	 * @param {Source} source
	 *   The source to spawn harvesters for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	addAdditionalHarvesters(source, options) {
		// Starting from RCL 4, 1 harvester per source should always be enough.
		if (source.room.controller.level > 3) return;

		// Don't spawn more harvesters than we have space for.
		if (source.harvesters.length >= source.getNumHarvestSpots()) return;

		let totalWorkParts = 0;
		for (const creep of source.harvesters) {
			totalWorkParts += creep.memory.body.work || 0;
		}

		// Remote builders want access to sources as well, so spawn less harvesters.
		for (const creep of _.values(source.room.creepsByRole['builder.remote']) || {}) {
			totalWorkParts += (creep.memory.body.work || 0) / 2;
		}

		const maxParts = this.getMaxWorkParts(source);
		if (totalWorkParts < maxParts) {
			options.push({
				priority: 4,
				weight: 1 - (totalWorkParts / maxParts),
				source: source.id,
				preferClosestSpawn: source.pos,
				size: maxParts,
				force: false,
			});
		}
	}

	/**
	 * Decides whether we have no other way to recover but to spawn with a reduced
	 * number of parts.
	 *
	 * @param {Room} room
	 *   The room to check.
	 *
	 * @return {boolean}
	 *   True if a small harvester should be spawned.
	 */
	isSmallHarvesterNeeded(room) {
		// If there's another harvester, we're fine.
		if (_.size(room.creepsByRole.harvester) > 0) return false;

		// Otherwise, rooms without a storage need a harvester always.
		if (!room.storage) return true;

		// Rooms with a storage need to have some energy left. In that case,
		// a transporter can be spawned and provide enough energy for a full
		// harvester.
		if (room.getStoredEnergy() < 5000) return true;

		return false;
	}

	/**
	 * Calculates the maximum number of work parts for harvesting a source.
	 *
	 * @param {Source} source
	 *   The source to calculate the number of work parts for.
	 *
	 * @return {number}
	 *   Number of needed work parts.
	 */
	getMaxWorkParts(source) {
		// @todo Factor in whether we control this room.
		let numParts = source.energyCapacity / ENERGY_REGEN_TIME / 2;

		_.each(source.effects, effect => {
			if (effect.power === PWR_REGEN_SOURCE) {
				numParts += POWER_INFO[PWR_REGEN_SOURCE].effect[effect.level - 1] / POWER_INFO[PWR_REGEN_SOURCE].period / 2;
			}
		});

		return 1.2 * numParts;
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
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.1, [WORK]: 0.7, [CARRY]: 0.2},
			Math.max(option.force ? 200 : room.energyCapacityAvailable * 0.9, room.energyAvailable),
			option.size && {[WORK]: option.size}
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
			fixedSource: option.source,
			operation: 'room:' + room.name,
		};
	}
};
