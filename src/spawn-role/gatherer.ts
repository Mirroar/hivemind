/* global MOVE CARRY */

import BodyBuilder from 'creep/body-builder';
import hivemind from 'hivemind';
import SpawnRole from 'spawn-role/spawn-role';
import {getRoomIntel} from 'room-intel';

interface GathererSpawnOption extends SpawnOption {
	targetRoom: string;
}

export default class GathererSpawnRole extends SpawnRole {
	/**
	 * Adds gatherer spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): GathererSpawnOption[] {
		if (!room.storage) return [];
		if (room.getEffectiveAvailableEnergy() < 5000) return [];

		const options: GathererSpawnOption[] = [];
		_.each(room.memory.abandonedResources, (resources, roomName) => {
			// @todo Estimate resource value.
			const totalAmount = _.sum(_.map(room.memory.abandonedResources, (m: Record<string, number>) => _.sum(m)));
			if (totalAmount < 5000) return;

			const gathererCount = _.filter(Game.creepsByRole.gatherer || [], (creep: Creep) => creep.memory.targetRoom === roomName && creep.memory.origin === room.name).length;
			// @todo Allow more gatherers at low priority if a lot of resources need
			// gathering.
			// @todo Make sure gatherers can reach their targets.
			// @todo Currently disabled on shard0 until we automaticall remove
			// pesky walls / ramparts.
			if (['shard0', 'shard1', 'shardSeason'].includes(Game.shard.name)) return;
			if (gathererCount > 0) return;
			if (!hivemind.segmentMemory.isReady() || getRoomIntel(roomName).isOwned()) return;

			options.push({
				priority: 2,
				weight: 0.8,
				targetRoom: roomName,
			});
		});

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
		return (new BodyBuilder())
			.setWeights({[CARRY]: 1})
			.setEnergyLimit(Math.max(room.energyCapacityAvailable * 0.9, Math.min(room.energyAvailable, room.energyCapacityAvailable)))
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
	getCreepMemory(room: Room, option: GathererSpawnOption): CreepMemory {
		return {
			origin: room.name,
			targetRoom: option.targetRoom,
		};
	}
}
