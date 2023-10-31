/* global MOVE WORK CARRY RESOURCE_ENERGY */

import BodyBuilder from 'creep/body-builder';
import settings from 'settings-manager';
import SpawnRole from 'spawn-role/spawn-role';
import {encodePosition, decodePosition} from 'utils/serialization';
import {ENEMY_STRENGTH_NORMAL} from 'room-defense';
import {getRoomIntel} from 'room-intel';
import {MOVEMENT_MODE_ROAD, MOVEMENT_MODE_PLAINS} from 'creep/body-builder';

interface RemoteHarvesterSpawnOption extends SpawnOption {
	targetPos: string;
	isEstablished: boolean;
	size: number;
}

export default class RemoteHarvesterSpawnRole extends SpawnRole {
	/**
	 * Adds remote harvester spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): RemoteHarvesterSpawnOption[] {
		if (room.defense.getEnemyStrength() >= ENEMY_STRENGTH_NORMAL) return [];
		if (settings.get('newRemoteMiningRoomFilter') && settings.get('newRemoteMiningRoomFilter')(room.name)) return [];

		const harvestPositions = room.getRemoteHarvestSourcePositions();
		const options: RemoteHarvesterSpawnOption[] = [];
		let offset = 0;
		for (const position of harvestPositions) {
			this.addOptionForPosition(room, position, options, offset++);
		}

		return options;
	}

	addOptionForPosition(room: Room, position: RoomPosition, options: RemoteHarvesterSpawnOption[], offset: number) {
		const targetPos = encodePosition(position);
		const operation = Game.operationsByType.mining['mine:' + position.roomName];

		// Don't spawn if enemies are in the room.
		if (!operation || operation.isUnderAttack() || operation.needsDismantler(targetPos)) return;

		// Don't spawn if there is no full path.
		const paths = operation.getPaths();
		const path = paths[targetPos];
		const travelTime = path?.travelTime;
		if (!travelTime) return;

		const option = {
			priority: 3,
			weight: 1 - offset * 0.5,
			targetPos,
			// @todo Consider established when roads are fully built.
			isEstablished: operation.hasContainer(targetPos),
			// Use less work parts if room is not reserved yet.
			size: operation.getHarvesterSize(targetPos),
		};

		const creepSpawnTime = this.getCreepBody(room, option).length * CREEP_SPAWN_TIME;
		const harvesters = _.filter(
			Game.creepsByRole['harvester.remote'] || {},
			(creep: RemoteHarvesterCreep) => {
				// @todo Instead of filtering for every room, this could be grouped once per tick.
				if (creep.memory.source !== targetPos) return false;

				if (creep.spawning) return true;
				if (creep.ticksToLive > Math.min(travelTime + creepSpawnTime, 500)) return true;

				return false;
			},
		);

		// Allow spawning multiple harvesters if more work parts are needed,
		// but no more than available spaces around the source.
		const roomIntel = getRoomIntel(position.roomName);
		let freeSpots = 1;
		for (const source of roomIntel.getSourcePositions()) {
			if (source.x === position.x && source.y === position.y) freeSpots = source.free || 1;
		}

		if (harvesters.length >= freeSpots) return;
		const workParts = _.sum(harvesters, creep => creep.getActiveBodyparts(WORK));
		if (workParts >= operation.getHarvesterSize(targetPos) * 0.5) return;

		options.push(option);
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
	getCreepBody(room: Room, option: RemoteHarvesterSpawnOption): BodyPartConstant[] {
		const bodyWeights = option.isEstablished ? {[WORK]: 1} : {[WORK]: 5, [CARRY]: 1};

		return (new BodyBuilder())
			.setWeights(bodyWeights)
			.setPartLimit(WORK, option.size)
			.setMovementMode(option.isEstablished ? MOVEMENT_MODE_ROAD : MOVEMENT_MODE_PLAINS)
			.setEnergyLimit(Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable))
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
	getCreepMemory(room: Room, option: RemoteHarvesterSpawnOption): RemoteHarvesterCreepMemory {
		return {
			role: 'harvester.remote',
			source: option.targetPos,
			operation: 'mine:' + decodePosition(option.targetPos).roomName,
		};
	}

	/**
	 * Act when a creep belonging to this spawn role is successfully spawning.
	 *
	 * @param {Room} room
	 *   The room the creep is spawned in.
	 * @param {Object} option
	 *   The spawn option which caused the spawning.
	 * @param {string[]} body
	 *   The body generated for this creep.
	 * @param {string} name
	 *   The name of the new creep.
	 */
	onSpawn(room: Room, option: RemoteHarvesterSpawnOption, body: BodyPartConstant[]) {
		const operationName = 'mine:' + decodePosition(option.targetPos).roomName;
		const operation = Game.operations[operationName];
		if (!operation) return;

		operation.addResourceCost(this.calculateBodyCost(body), RESOURCE_ENERGY);
	}
}
