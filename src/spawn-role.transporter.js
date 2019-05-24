'use strict';

const SpawnRole = require('./spawn-role');

module.exports = class TransporterSpawnRole extends SpawnRole {
	/**
	 * Adds transporter spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		const numSources = _.size(room.sources);
		const numTransporters = _.size(room.creepsByRole.transporter);
		let maxTransporters = 2 + (2 * numSources); // @todo Find a good way to gauge needed number of transporters by measuring distances.

		for (const i in room.sources) {
			// If we have a link to beam energy around, we'll need less transporters.
			if (room.sources[i].getNearbyLink() && room.memory.controllerLink) {
				maxTransporters--;
			}
		}

		// Need less transporters if energy gets beamed around the place a lot.
		if (room.memory.controllerLink && room.memory.storageLink) {
			maxTransporters--;
		}

		if (room.controller.level === 6) {
			// RCL 6 is that annoying level at which refilling extensions is very tedious and there are many things that need spawning.
			maxTransporters++;
		}

		// Need less transporters in rooms where remote builders are working.
		maxTransporters -= _.size(room.creepsByRole['builder.remote']);

		// On low level rooms, do not use (too many) transporters.
		if (room.controller.level < 3) {
			maxTransporters = 1;
		}

		if (room.controller.level < 4 || !room.storage) {
			// Storage mostly takes place in containers, units will get their energy from there.
			maxTransporters = 2;
		}

		// On higher level rooms, spawn less, but bigger, transporters.
		let sizeFactor = 1;
		if (room.controller.level >= 7) {
			sizeFactor = 2;
		}
		else if (room.controller.level >= 6) {
			sizeFactor = 1.5;
		}
		else if (room.controller.level >= 5) {
			sizeFactor = 1.25;
		}

		sizeFactor *= 1.5;
		maxTransporters /= 1.2;

		maxTransporters /= sizeFactor;
		maxTransporters = Math.max(maxTransporters, 2);

		if (room.isClearingTerminal() && room.terminal && _.sum(room.terminal.store) > room.terminal.storeCapacity * 0.01) {
			maxTransporters *= 1.5;
		}

		if (numTransporters < maxTransporters) {
			const option = {
				priority: 5,
				weight: 0.5,
				role: 'transporter',
				force: false,
				size: 8 * sizeFactor,
			};

			if (numTransporters >= maxTransporters / 2) {
				option.priority = 4;
			}
			else if (numTransporters > 1) {
				option.weight = 0;
			}
			else {
				option.force = true;
			}

			options.push(option);
		}
	}
};
