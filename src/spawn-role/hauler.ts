/* global MOVE WORK CARRY RESOURCE_ENERGY */

import BodyBuilder from 'creep/body-builder';
import settings from 'settings-manager';
import SpawnRole from 'spawn-role/spawn-role';
import {encodePosition, decodePosition} from 'utils/serialization';
import {ENEMY_STRENGTH_NORMAL} from 'room-defense';
import {MOVEMENT_MODE_ROAD, MOVEMENT_MODE_PLAINS} from 'creep/body-builder';

interface HaulerSpawnOption extends SpawnOption {
	targetPos: string;
	size: number;
	builder: boolean;
}

export default class HaulerSpawnRole extends SpawnRole {
	/**
	 * Adds remote harvester spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): HaulerSpawnOption[] {
		if (room.defense.getEnemyStrength() >= ENEMY_STRENGTH_NORMAL) return [];
		if (settings.get('newRemoteMiningRoomFilter') && settings.get('newRemoteMiningRoomFilter')(room.name)) return [];

		const options: HaulerSpawnOption[] = [];
		const harvestPositions = room.getRemoteHarvestSourcePositions();

		let offset = 0;
		for (const position of harvestPositions) {
			this.addOptionForPosition(room, position, options, offset++);
		}

		return options;
	}

	addOptionForPosition(room: Room, position: RoomPosition, options: HaulerSpawnOption[], offset: number) {
		const targetPos = encodePosition(position);
		const operation = Game.operationsByType.mining['mine:' + position.roomName];

		// Don't spawn if enemies are in the room.
		// @todo Or in any room on the route, actually.
		if (!operation || operation.isUnderAttack() || !operation.shouldSpawnHaulers(targetPos)) return;

		// Don't spawn if there is no full path.
		const paths = operation.getPaths();
		const path = paths[targetPos];
		const travelTime = path?.travelTime;
		if (!travelTime) return;

		const requiredCarryParts = operation.getHaulerSize(targetPos);

		// Determine how many haulers to spawn for this route.
		// If we cannot create big enough haulers (yet), create more of them!
		const maximumBody = (new BodyBuilder())
			.setWeights(this.getBodyWeights())
			.setPartLimit(CARRY, requiredCarryParts)
			.setMovementMode(MOVEMENT_MODE_ROAD)
			.setEnergyLimit(room.energyCapacityAvailable)
			.build();
		const maxCarryPartsOnBiggestBody = _.countBy(maximumBody)[CARRY];
		const maxCarryPartsToEmptyContainer = Math.ceil(0.9 * CONTAINER_CAPACITY / CARRY_CAPACITY);
		const maxCarryParts = Math.min(maxCarryPartsOnBiggestBody, maxCarryPartsToEmptyContainer);
		const maxHaulers = Math.ceil(requiredCarryParts / maxCarryParts);
		const adjustedCarryParts = Math.ceil(requiredCarryParts / maxHaulers);

		const haulers = _.filter(
			Game.creepsByRole.hauler || {},
			(creep: HaulerCreep) => {
				// @todo Instead of filtering for every room, this could be grouped once per tick.
				if (creep.memory.source !== targetPos) return false;

				if (creep.spawning) return true;
				if (creep.ticksToLive > (travelTime * 2) || creep.ticksToLive > 500) return true;

				return false;
			},
		);

		const currentCarryParts = _.sum(haulers, creep => creep.getActiveBodyparts(CARRY));

		if (currentCarryParts >= requiredCarryParts) return;

		options.push({
			priority: 3,
			weight: 0.8 - offset * 0.5 - haulers.length * 0.75,
			targetPos,
			size: adjustedCarryParts,
			builder: operation.needsBuilder(targetPos) && _.filter(haulers, c => c.getActiveBodyparts(WORK) > 0).length === 0,
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
	getCreepBody(room: Room, option: HaulerSpawnOption): BodyPartConstant[] {
		const hasRoads = room.controller.level > 3 && (room.storage || room.terminal);

		return (new BodyBuilder())
			.setWeights(option.builder ? this.getBuilderBodyWeights() : this.getBodyWeights())
			.setPartLimit(CARRY, option.size)
			.setMovementMode(hasRoads ? MOVEMENT_MODE_ROAD : MOVEMENT_MODE_PLAINS)
			.setEnergyLimit(Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable))
			.build();
	}

	/**
	 * Determine body weights for haulers.
	 *
	 * @return {object}
	 *   An object containing body part weights, keyed by type.
	 */
	getBodyWeights(): Partial<Record<BodyPartConstant, number>> {
		return {[CARRY]: 1};
	}

	/**
	 * Determine body weights for haulers that also maintain roads.
	 *
	 * @return {object}
	 *   An object containing body part weights, keyed by type.
	 */
	getBuilderBodyWeights(): Partial<Record<BodyPartConstant, number>> {
		return {[CARRY]: 10, [WORK]: 3};
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
	getCreepMemory(room: Room, option: HaulerSpawnOption): HaulerCreepMemory {
		return {
			role: 'hauler',
			source: option.targetPos,
			operation: 'mine:' + decodePosition(option.targetPos).roomName,
			delivering: false,
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
	onSpawn(room: Room, option: HaulerSpawnOption, body: BodyPartConstant[]) {
		const operationName = 'mine:' + decodePosition(option.targetPos).roomName;
		const operation = Game.operations[operationName];
		if (!operation) return;

		operation.addResourceCost(this.calculateBodyCost(body), RESOURCE_ENERGY);
	}
}
