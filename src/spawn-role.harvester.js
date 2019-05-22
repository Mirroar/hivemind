'use strict';

const HarvesterSpawnRole = function () {

};

HarvesterSpawnRole.prototype.getSpawnOptions = function (room, options) {
	// If we have no other way to recover, spawn with reduced amounts of parts.
	let force = false;
	if (_.size(room.creepsByRole.harvester) === 0 && (!room.storage || (_.size(room.creepsByRole.transporter) === 0 && room.getStoredEnergy() < 5000))) {
		force = true;
	}

	if (!force && room.isFullOnEnergy()) return;

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

module.exports = HarvesterSpawnRole;
