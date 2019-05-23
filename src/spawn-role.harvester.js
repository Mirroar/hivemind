'use strict';

/**
 * @constructor
 */
const HarvesterSpawnRole = function () {};

/**
 * Adds spawn options for the given room.
 *
 * @param {Room} room
 *   The room to add spawn options for.
 * @param {Object[]} options
 *   A list of spawn options to add to.
 */
HarvesterSpawnRole.prototype.getSpawnOptions = function (room, options) {
	const force = this.isSmallHarvesterNeeded(room);

	// Stop harvesting if we can't really store any more energy.
	if (room.isFullOnEnergy() && !force) return;

	for (const source of room.sources) {
		const maxParts = source.getMaxWorkParts();
		// Make sure at least one harvester is spawned for each source.
		if (source.harvesters.length === 0) {
			options.push({
				priority: (force ? 5 : 4),
				weight: 1,
				role: 'harvester',
				source: source.id,
				maxWorkParts: maxParts,
				force,
			});

			continue;
		}

		if (room.controller.level > 3) continue;
		if (source.harvesters.length >= source.getNumHarvestSpots()) continue;

		// If there's still space at this source, spawn additional harvesters until the maximum number of work parts has been reached.
		// Starting from RCL 4, 1 harvester per source should always be enough.
		let totalWorkParts = 0;
		for (const creep of source.harvesters) {
			totalWorkParts += creep.memory.body.work || 0;
		}

		for (const creep of _.values(room.creepsByRole['builder.remote']) || {}) {
			totalWorkParts += (creep.memory.body.work || 0) / 2;
		}

		if (totalWorkParts < maxParts) {
			options.push({
				priority: 4,
				weight: 1 - (totalWorkParts / maxParts),
				role: 'harvester',
				source: source.id,
				maxWorkParts: maxParts - totalWorkParts,
				force: false,
			});
		}
	}
};

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
HarvesterSpawnRole.prototype.isSmallHarvesterNeeded = function (room) {
	// If there's another harvester, we're fine.
	if (_.size(room.creepsByRole.harvester) > 0) return false;

	// Otherwise, rooms without a storage need a harvester always.
	if (!room.storage) return true;

	// Rooms with a storage need to have some energy left. In that case,
	// a transporter can be spawned and provide enough energy for a full
	// harvester.
	if (room.getStoredEnergy() < 5000) return true;

	return false;
};

module.exports = HarvesterSpawnRole;
