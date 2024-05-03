/* global FIND_MY_CONSTRUCTION_SITES MOVE WORK CARRY */

import BodyBuilder, {MOVEMENT_MODE_ROAD} from 'creep/body-builder';
import cache from 'utils/cache';
import SpawnRole from 'spawn-role/spawn-role';
import {ENEMY_STRENGTH_NORMAL} from 'room-defense';

interface BuilderSpawnOption extends SpawnOption {
	size: number;
}

export default class BuilderSpawnRole extends SpawnRole {
	/**
	 * Adds builder spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): BuilderSpawnOption[] {
		return this.cacheEmptySpawnOptionsFor(room, 50, () => {
			const maxWorkParts = this.getNeededWorkParts(room);

			let numberWorkParts = 0;
			_.each(room.creepsByRole.builder, creep => {
				numberWorkParts += creep.getActiveBodyparts(WORK) || 0;
			});

			if (numberWorkParts >= maxWorkParts) return [];

			const availableEnergy = room.getEffectiveAvailableEnergy();
			// @todo Use target wall health to determine if we need stronger ramparts.
			const needsStrongerRamparts = room.terminal && this.getLowestRampartValue(room) < 3_000_000 && availableEnergy > 10_000;
			const needsBuildings = room.find(FIND_MY_CONSTRUCTION_SITES).length > 0;

			return [{
				priority: (needsStrongerRamparts || needsBuildings) ? 4 : 3,
				weight: 0.5,
				size: room.isEvacuating() ? 3 : null,
			}];
		});
	}

	/**
	 * Determine how many work parts we need on builders in this room.
	 *
	 * @param {Room} room
	 *   The room to check.
	 *
	 * @return {number}
	 *   The number of work parts needed.
	 */
	getNeededWorkParts(room: Room): number {
		const numberConstructionSites = room.find(FIND_MY_CONSTRUCTION_SITES).length;
		const hasStorage = room.storage || room.terminal;

		if (numberConstructionSites === 0 && room.memory.noBuilderNeeded && Game.time - room.memory.noBuilderNeeded < 1500 && hasStorage) {
			return 0;
		}

		const availableEnergy = room.getEffectiveAvailableEnergy();
		if (hasStorage && availableEnergy < 5000) {
			// Wait for room economy to kick in a little.
			return 0;
		}

		if (room.isEvacuating()) {
			// Just spawn a small builder for keeping roads intact.
			return 1;
		}

		if (hasStorage && availableEnergy < 10_000) {
			// Just spawn a small builder for keeping roads intact. Wait for
			// harvesting to fill up storage.
			return 1;
		}

		if (availableEnergy < 10_000 && _.size(room.creepsByRole.harvester) <= 1) {
			const activeHarvesters = _.size(room.creepsByRole.harvester) + _.filter(Game.creepsByRole['harvester.remote'], (creep: RemoteHarvesterCreep) => creep.memory.sourceRoom === room.name).length;

			// Don't overspawn builders if there's hardly any energy income.
			if (activeHarvesters < _.size(room.sources)) return 1;
		}

		let maxWorkParts = 5;
		if (room.controller.level > 2) {
			maxWorkParts += 5;
		}

		// There are a lot of ramparts in planned rooms, spawn builders appropriately.
		// @todo Only if they are not fully built, of course.
		if (room.roomPlanner && room.controller.level >= 4) {
			maxWorkParts += _.size(room.roomPlanner.getLocations('rampart')) / 10;
		}

		// Add more builders if we have a lot of energy to spare.
		if (!hasStorage) {
			// Small rooms that don't have a storage yet should spawn builders
			// depending on available energy - excess will be used for upgrading.
			maxWorkParts *= 1 + availableEnergy / 3000;
		}
		else if (availableEnergy > 400_000) {
			maxWorkParts *= 2;
		}
		else if (availableEnergy > 200_000) {
			maxWorkParts *= 1.5;
		}

		// Add more builders if we're moving a spawn.
		if (room.roomManager?.hasMisplacedSpawn()) {
			maxWorkParts *= 2;
		}

		// Add more builders if we have a terminal, but ramparts are too low to
		// reasonably protect the room.
		if (room.terminal && this.getLowestRampartValue(room) < 3_000_000 && availableEnergy > 10_000) {
			maxWorkParts *= 2.5;
		}

		if (room.controller.level > 3) {
			// Spawn more builders depending on total size of current construction sites.
			// @todo Use hitpoints of construction sites vs number of work parts as a guide.
			maxWorkParts += numberConstructionSites / 2;
		}

		return maxWorkParts;
	}

	/**
	 * Gets lowest number of hit points of all ramparts in the room.
	 *
	 * @return {number}
	 *   Number of hits for the lowest rampart.
	 */
	getLowestRampartValue(room: Room): number {
		return cache.inHeap('lowestRampart:' + room.name, 100, () => {
			const ramparts = _.filter(
				room.myStructuresByType[STRUCTURE_RAMPART],
				s => room.roomPlanner?.isPlannedLocation(s.pos, 'rampart')
					&& !room.roomPlanner?.isPlannedLocation(s.pos, 'rampart.ramp'),
			);

			return _.min(ramparts, 'hits').hits;
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
	getCreepBody(room: Room, option: BuilderSpawnOption): BodyPartConstant[] {
		return (new BodyBuilder())
			.setWeights({[WORK]: 4, [CARRY]: 3})
			.setMovementMode(MOVEMENT_MODE_ROAD)
			.setPartLimit(WORK, option.size)
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
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
	getCreepMemory(room: Room): BuilderCreepMemory {
		return {
			role: 'builder',
			singleRoom: room.name,
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
	getCreepBoosts(room: Room, option: BuilderSpawnOption, body: BodyPartConstant[]): Record<string, ResourceConstant> {
		// Only boost if ramparts need a lot of repairs.
		if (room.defense.getEnemyStrength() <= ENEMY_STRENGTH_NORMAL) return {};

		return this.generateCreepBoosts(room, body, WORK, 'repair');
	}
}
