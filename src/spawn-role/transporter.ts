/* global MOVE CARRY */

import SpawnRole from 'spawn-role/spawn-role';

export default class TransporterSpawnRole extends SpawnRole {
	/**
	 * Adds transporter spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		const transporterSize = this.getTransporterSize(room);
		const maxTransporters = this.getTransporterAmount(room, transporterSize);

		const numTransporters = _.size(room.creepsByRole.transporter);
		if (numTransporters < maxTransporters) {
			const option = {
				priority: 5,
				weight: 0.5,
				force: false,
				size: transporterSize,
			};

			if (numTransporters >= maxTransporters / 2) {
				option.priority = 4;
			}
			else if (numTransporters > 1) {
				option.weight = 0;
			}
			else {
				option.force = true;
				option.priority = room.storage ? 6 : 5;
				option.weight = 1;
			}

			options.push(option);
		}
	}

	/**
	 * Determines number of transporters needed in a room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {number} transporterSize
	 *   Maximum size of transporters in this room.
	 *
	 * @return {number}
	 *   Number of transporters needed in this room.
	 */
	getTransporterAmount(room, transporterSize) {
		let maxTransporters = this.getTransporterBaseAmount(room) * 2 / 3;

		// On higher level rooms, spawn less, but bigger, transporters.
		maxTransporters /= transporterSize;
		if (room.controller.level > 6) {
			maxTransporters = Math.max(maxTransporters, 2);
		}
		else {
			maxTransporters = Math.max(maxTransporters, 3);
		}

		if (room.isClearingTerminal() && room.terminal && room.terminal.store.getUsedCapacity() > room.terminal.store.getCapacity() * 0.01) {
			maxTransporters *= 1.5;
		}

		if (room.isClearingStorage() && room.storage && room.storage.store.getUsedCapacity() > room.storage.store.getCapacity() * 0.01) {
			maxTransporters *= 1.5;
		}

		return maxTransporters;
	}

	/**
	 * Determines a base amount of transporters needed in a room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 *
	 * @return {number}
	 *   Number of transporters needed in this room.
	 */
	getTransporterBaseAmount(room) {
		// On low level rooms, do not use (too many) transporters.
		if (room.controller.level < 3) return 1;
		if (room.controller.level < 4) return 2;

		// Storage mostly takes place in containers, units will get their energy from there.
		if (!room.storage) return 2;

		const numSources = _.size(room.sources);
		let maxTransporters = 2 + (2 * numSources); // @todo Find a good way to gauge needed number of transporters by measuring distances.

		// If we have links to beam energy around, we'll need less transporters.
		if (room.memory.controllerLink) {
			maxTransporters -= _.sum(room.sources, (source: Source) => source.getNearbyLink() ? 1 : 0);

			// Need less transporters if energy gets beamed around the place a lot.
			if (room.memory.controllerLink) {
				maxTransporters--;
			}
		}

		// RCL 5 and 6 are that annoying level at which refilling extensions is
		// very tedious and there are many things that need spawning.
		if (room.controller.level === 5) maxTransporters++;
		if (room.controller.level === 6) maxTransporters++;

		// Need less transporters in rooms where remote builders are working.
		maxTransporters -= _.size(room.creepsByRole['builder.remote']);

		return maxTransporters;
	}

	/**
	 * Determines maximum size of transporters in a room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 *
	 * @return {number}
	 *   Size of transporters for this room.
	 */
	getTransporterSize(room) {
		if (room.controller.level >= 7) return 24;
		if (room.controller.level >= 6) return 18;
		if (room.controller.level >= 5) return 15;
		return 12;
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
			{[MOVE]: 0.35, [CARRY]: 0.65},
			Math.max(option.force ? 250 : room.energyCapacityAvailable * 0.9, room.energyAvailable),
			{[CARRY]: option.size || 8}
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
	getCreepMemory(room) {
		return {
			singleRoom: room.name,
			operation: 'room:' + room.name,
		};
	}
};
