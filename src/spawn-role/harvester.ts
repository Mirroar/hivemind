/* global ENERGY_REGEN_TIME PWR_REGEN_SOURCE POWER_INFO MOVE WORK CARRY */

import BodyBuilder, {MOVEMENT_MODE_MINIMAL, MOVEMENT_MODE_ROAD} from 'creep/body-builder';
import SpawnRole from 'spawn-role/spawn-role';
import {getDangerMatrix} from 'utils/cost-matrix';
import {handleMapArea} from 'utils/map';
import stats from 'utils/stats';

interface HarvesterSpawnOption extends SpawnOption {
	source: Id<Source>;
	size: number;
	force: boolean;
}

export default class HarvesterSpawnRole extends SpawnRole {
	/**
	 * Adds harvester spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): HarvesterSpawnOption[] {
		return this.cacheEmptySpawnOptionsFor(room, 10, () => {
			// Stop harvesting if we can't really store any more energy.
			if (room.isFullOnEnergy() && !this.isSmallHarvesterNeeded(room)) return [];

			const options: HarvesterSpawnOption[] = [];
			for (const source of room.sources) {
				this.addInitialHarvester(source, options);
				this.addAdditionalHarvesters(source, options);
			}

			return options;
		});
	}

	/**
	 * Spawns a harvester at every source.
	 *
	 * @param {Source} source
	 *   The source to spawn harvesters for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	addInitialHarvester(source: Source, options: HarvesterSpawnOption[]) {
		// Spawn new harvester before previous harvester dies.
		const spawns = _.filter(Game.spawns, spawn => spawn.room.name === source.room.name);
		const minSpawnDistance = _.min(_.map(spawns, spawn => spawn.pos.getRangeTo(source.pos)));
		const activeHarvesters = _.filter(source.harvesters, creep => creep.spawning || creep.ticksToLive > creep.body.length * CREEP_SPAWN_TIME + minSpawnDistance);

		if (activeHarvesters.length > 0) return;
		if (!this.isSourceSafe(source)) return;

		const force = this.isSmallHarvesterNeeded(source.room);
		options.push({
			priority: (force ? 6 : (this.isEarlyGame(source.room) ? 5 : 4)),
			weight: (50 - minSpawnDistance) / 50,
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
	addAdditionalHarvesters(source: Source, options: HarvesterSpawnOption[]) {
		// Starting from RCL 4, 1 harvester per source should always be enough.
		if (source.room.controller.level > 3) return;

		// Don't spawn more harvesters than we have space for.
		if (source.harvesters.length >= source.getNumHarvestSpots()) return;
		if (!this.isSourceSafe(source)) return;

		let totalWorkParts = 0;
		for (const creep of source.harvesters) {
			totalWorkParts += creep.getActiveBodyparts(WORK) || 0;
		}

		const spawns = _.filter(Game.spawns, spawn => spawn.room.name === source.room.name);
		const minSpawnDistance = _.min(_.map(spawns, spawn => spawn.pos.getRangeTo(source.pos)));
		const maxParts = this.getMaxWorkParts(source);
		if (totalWorkParts < maxParts) {
			options.push({
				priority: this.isEarlyGame(source.room) ? 5 : 4,
				weight: 1 - (totalWorkParts / maxParts / 2) - ((50 - minSpawnDistance) / 100),
				source: source.id,
				preferClosestSpawn: source.pos,
				size: maxParts,
				force: false,
			});
		}
	}

	isSourceSafe(source: Source) {
		const dangerMatrix = getDangerMatrix(source.room.name);

		let safe = true;
		handleMapArea(source.pos.x, source.pos.y, (x, y) => {
			if (dangerMatrix.get(x, y) > 0) {
				safe = false;
				return false;
			}

			return null;
		});

		return safe;
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
	isSmallHarvesterNeeded(room: Room): boolean {
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
	getMaxWorkParts(source: Source): number {
		let numberOfParts = source.energyCapacity / ENERGY_REGEN_TIME / 2;

		_.each(source.effects, effect => {
			if (effect.effect === PWR_REGEN_SOURCE) {
				numberOfParts += POWER_INFO[PWR_REGEN_SOURCE].effect[effect.level - 1] / POWER_INFO[PWR_REGEN_SOURCE].period / 2;
			}
		});

		return this.getHarvesterSizeFactor(source.room) * numberOfParts;
	}

	getHarvesterSizeFactor(room: Room) {
		if (!this.shouldSpawnOversizedHarvesters()) return 1;

		if (room.controller.level >= 8) return 2;
		if (room.controller.level >= 7) return 1.8;
		if (room.controller.level >= 6) return 1.5;

		return 1;
	}

	shouldSpawnOversizedHarvesters() {
		return (stats.getStat('cpu_total', 1000) || 0) / Game.cpu.limit > 0.75;
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
	getCreepBody(room: Room, option: HarvesterSpawnOption): BodyPartConstant[] {
		const source = Game.getObjectById(option.source);
		const hasSpawnAtSource = _.some(room.myStructuresByType[STRUCTURE_SPAWN], s => source.pos.getRangeTo(s.pos) <= 2 && s.isOperational());
		const hasFewExtensions = room.energyCapacityAvailable < SPAWN_ENERGY_CAPACITY * 2;

		return (new BodyBuilder())
			.setWeights({[WORK]: 4, [CARRY]: 1})
			.setPartLimit(WORK, option.size)
			.setMovementMode(hasSpawnAtSource || hasFewExtensions ? MOVEMENT_MODE_MINIMAL : MOVEMENT_MODE_ROAD)
			.setCarryContentLevel(0)
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(option.force ? SPAWN_ENERGY_CAPACITY : room.energyCapacityAvailable, room.energyAvailable)))
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
	getCreepMemory(room: Room, option: HarvesterSpawnOption): HarvesterCreepMemory {
		return {
			role: 'harvester',
			singleRoom: room.name,
			fixedSource: option.source,
			operation: 'room:' + room.name,
		};
	}

	isEarlyGame(room: Room): boolean {
		if (room.storage || room.terminal) return false;

		return true;
	}
}
