/* global MOVE CARRY */

import BodyBuilder from 'creep/body-builder';
import cache from 'utils/cache';
import SpawnRole from 'spawn-role/spawn-role';
import {MOVEMENT_MODE_ROAD} from 'creep/body-builder';

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

			const hasHaulers
				= _.filter(Game.creepsByRole.hauler, creep => creep.memory.sourceRoom === room.name).length
				+ _.filter(Game.creepsByRole['hauler.relay'], creep => creep.memory.sourceRoom === room.name).length > 0;
			const hasExtensions = (room.myStructuresByType[STRUCTURE_EXTENSION] || []).length > 0;
			if (transporterCount >= maxTransporters / 2) {
				option.priority--;
				option.priority--;
			}
			else if (transporterCount >= 1) {
				option.priority--;
				option.weight = 0;
			}
			else if (room.storage || room.terminal || (!hasHaulers && hasExtensions)) {
				option.force = true;
				option.weight = 1;
			}
			else if (!room.storage && !room.terminal) {
				const spawns = _.filter(Game.spawns, spawn => spawn.room.name === room.name);
				const sources = room.sources;
				const minSpawnDistance = _.min(_.map(spawns, spawn => _.min(_.map(sources, source => spawn.pos.getRangeTo(source.pos)))));
				if (minSpawnDistance < 5) {
					option.priority--;
					option.weight = 0;
				}
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
		if (!room.storage && !room.terminal) return room.getEffectiveAvailableEnergy() > 1000 ? 2 : 1;

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

		return Math.ceil(fullBayCapacity / CARRY_CAPACITY);
	}

	estimateNeededCarryParts(room: Room): number {
		return cache.inHeap('estimatedCarryParts:' + room.name, 500, () => {
			const total = 0;

			// Path length to active bays, weighted by energy needs. Exclude harvester bays.

			// Path to sources, exclude those with links if we have controller link

			// Path length to active minerals

			// Path length to labs

			return total;
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
	getCreepBody(room: Room, option: TransporterSpawnOption): BodyPartConstant[] {
		return (new BodyBuilder())
			.setWeights({[CARRY]: 1})
			.setPartLimit(CARRY, option.size ?? 8)
			.setMovementMode(MOVEMENT_MODE_ROAD)
			.setEnergyLimit(Math.max(option.force ? 250 : room.energyCapacityAvailable * 0.9, room.energyAvailable),)
			.build();
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
