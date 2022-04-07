/* global RoomPosition CREEP_LIFE_TIME CREEP_SPAWN_TIME MAX_CREEP_SIZE
ATTACK POWER_BANK_HIT_BACK ATTACK_POWER HEAL_POWER MOVE HEAL */

import cache from 'utils/cache';
import hivemind from 'hivemind';
import NavMesh from 'utils/nav-mesh';
import SpawnRole from 'spawn-role/spawn-role';
import {encodePosition, decodePosition} from 'utils/serialization';
import {getRoomIntel} from 'intel-management';
import {isCrossroads} from 'utils/room-name';
import {unpackCoordAsPos} from 'utils/packrat';

export default class CaravanTraderSpawnRole extends SpawnRole {
	/**
	 * Adds gift spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room: Room, options) {
		if (!hivemind.settings.get('season4EnableCaravanDelivery')) return;
		if (room.getStoredEnergy() < (BODYPART_COST[CARRY] + BODYPART_COST[MOVE]) * MAX_CREEP_SIZE / 2) return;
		if (!Memory.strategy || !Memory.strategy.caravans) return;

		_.each(Memory.strategy.caravans, (info, id) => {
			if (Game.time > info.expires) return;
			if (!this.isARoomInRange(room, info.rooms)) return;

			for (const resourceType in info.contents) {
				if (info.contents[resourceType] >= 1000) continue;
				if (room.getCurrentResourceAmount(resourceType) === 0) continue;

				const activeTraders = _.filter(Game.creepsByRole['caravan-trader'] || [], (creep: CaravanTraderCreep) => {
					if (creep.memory.target !== id) return false;
					if (creep.memory.origin !== room.name) return false;
					if (creep.memory.resourceType !== resourceType) return false;

					return true;
				});

				if (activeTraders.length < 1) {
					options.push({
						priority: 4,
						weight: 0,
						target: id,
						resourceType,
					});
				}
			}
		});
	}

	isARoomInRange(room: Room, targetRooms: {name: string, time: number}[]): boolean {
		if (!hivemind.segmentMemory.isReady()) return false;

		const mesh = new NavMesh();
		const sourcePos = room.roomPlanner.getRoomCenter();
		const spawnTime = Math.min(MAX_CREEP_SIZE, Math.ceil(1000 / CARRY_CAPACITY) * 2) * CREEP_SPAWN_TIME;

		for (const target of targetRooms) {
			const targetPosition = new RoomPosition(25, 25, target.name);
			const travelTime = mesh.estimateTravelTime(sourcePos, targetPosition);
			if (!travelTime) continue;

			if (Game.time + spawnTime + travelTime < target.time + (isCrossroads(target.name) ? 50 : 100)) return true;
		}

		return false;
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
		const availableResources = room.getCurrentResourceAmount(option.resourceType);

		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [CARRY]: 0.5},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
			{[CARRY]: Math.ceil(Math.min(1000, availableResources) / CARRY_CAPACITY)}
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
	getCreepMemory(room, option): CaravanTraderCreepMemory {
		return {
			role: 'caravan-trader',
			delivering: false,
			origin: room.name,
			target: option.target,
			resourceType: option.resourceType,
		};
	}

	onSpawn(room: Room, option, body: BodyPartConstant[], name: string) {
		hivemind.log('creeps', room.name).notify('Spawned new caravan trader ' + name + ' in ' + room.name + ' to deliver ' + option.resourceType + '.');
	}
};
