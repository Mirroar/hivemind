/* global MOVE CARRY */

import SpawnRole from 'spawn-role/spawn-role';

interface TransporterSpawnOption extends SpawnOption {
	force: boolean;
	size: number;
}

export default class TransporterSpawnRole extends SpawnRole {
	/**
	 * Adds transporter spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room) {
		const options: TransporterSpawnOption[] = [];

		const transporterSize = this.getTransporterSize(room);
		const maxTransporters = this.getTransporterAmount(room, transporterSize);

		const transporterCount = _.size(room.creepsByRole.transporter);
		if (transporterCount < maxTransporters) {
			const option: TransporterSpawnOption = {
				priority: (room.storage || room.terminal) ? 6 : 5,
				weight: 0.5,
				force: false,
				size: transporterSize,
			};

			if (transporterCount >= maxTransporters / 2) {
				option.priority--;
				option.priority--;
			}
			else if (transporterCount > 1) {
				option.priority--;
				option.weight = 0;
			}
			else if (room.storage || room.terminal) {
				option.force = true;
				option.weight = 1;
			}

			options.push(option);
		}

		return options;
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
	getTransporterAmount(room: Room, transporterSize: number): number {
		let maxTransporters = this.getTransporterBaseAmount(room) * 2 / 3;

		// On higher level rooms, spawn less, but bigger, transporters.
		maxTransporters /= transporterSize;
		maxTransporters = Math.max(maxTransporters, room.controller.level > 6 ? 2 : 3);

		if (room.isClearingTerminal() && room.terminal && room.terminal.store.getUsedCapacity() > room.terminal.store.getCapacity() * 0.01) {
			maxTransporters *= 1.5;
		}

		if (room.isClearingStorage() && room.storage && room.storage.store.getUsedCapacity() > room.storage.store.getCapacity() * 0.01) {
			maxTransporters *= 1.5;
		}

		if (room.controller.level < 4) {
			// Check if a container is nearly full.
			for (const source of room.sources) {
				const container = source.getNearbyContainer();
				if (container && container.store.getFreeCapacity() < container.store.getCapacity() / 4) {
					maxTransporters++;
				}
			}
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
	getTransporterBaseAmount(room: Room): number {
		// On low level rooms, do not use (too many) transporters.
		if (room.controller.level < 3) return 1;
		if (room.controller.level < 4) return 2;

		// Storage mostly takes place in containers, units will get their energy from there.
		if (!room.storage) return 2;

		const sourceCount = _.size(room.sources);
		let maxTransporters = 2 + (2 * sourceCount); // @todo Find a good way to gauge needed number of transporters by measuring distances.

		// If we have links to beam energy around, we'll need less transporters.
		if (room.memory.controllerLink) {
			maxTransporters -= 1 + _.sum(room.sources, (source: Source) => source.getNearbyLink() ? 1 : 0);
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
	getTransporterSize(room: Room): number {
		const fullBayCapacity = Math.max(SPAWN_ENERGY_CAPACITY, EXTENSION_ENERGY_CAPACITY[room.controller.level]) + 6 * EXTENSION_ENERGY_CAPACITY[room.controller.level];
		if (room.controller.level >= 7) return Math.max(24, fullBayCapacity / CARRY_CAPACITY);
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
	getCreepBody(room: Room, option: TransporterSpawnOption): BodyPartConstant[] {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.35, [CARRY]: 0.65},
			Math.max(option.force ? 250 : room.energyCapacityAvailable * 0.9, room.energyAvailable),
			{[CARRY]: option.size ?? 8},
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
	getCreepMemory(room: Room): CreepMemory {
		return {
			singleRoom: room.name,
			operation: 'room:' + room.name,
		};
	}
}
