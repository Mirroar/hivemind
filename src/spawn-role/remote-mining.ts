/* global MOVE CLAIM BODYPART_COST CONTROLLER_RESERVE_MAX RESOURCE_ENERGY */

import settings from 'settings-manager';
import SpawnRole from 'spawn-role/spawn-role';
import {encodePosition} from 'utils/serialization';
import {ENEMY_STRENGTH_NORMAL} from 'room-defense';
import {getRoomIntel} from 'room-intel';

interface ClaimerSpawnOption extends SpawnOption {
	unitType: 'claimer';
	targetPos: RoomPosition;
}

interface HarvesterSpawnOption extends SpawnOption {
	unitType: 'harvester';
	targetPos: RoomPosition;
	isEstablished: boolean;
	size: number;
}

interface HaulerSpawnOption extends SpawnOption {
	unitType: 'hauler';
	size: number;
}

type RemoteMiningSpawnOption = ClaimerSpawnOption | HarvesterSpawnOption | HaulerSpawnOption;

export default class RemoteMiningSpawnRole extends SpawnRole {
	/**
	 * Adds claimer spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): RemoteMiningSpawnOption[] {
		if (!settings.get('newRemoteMiningRoomFilter') || !settings.get('newRemoteMiningRoomFilter')(room.name)) return [];
		if (room.defense.getEnemyStrength() >= ENEMY_STRENGTH_NORMAL) return [];

		const options: RemoteMiningSpawnOption[] = [];

		this.addHaulerSpawnOptions(room, options);
		this.addBuilderSpawnOptions(room, options);
		this.addClaimerSpawnOptions(room, options);
		this.addHarvesterSpawnOptions(room, options);

		return options;
	}

	addHaulerSpawnOptions(room: Room, options: RemoteMiningSpawnOption[]) {
		const currentlyNeededCarryParts = this.getNeededCarryParts(room);
		const currentHaulers = _.filter(Game.creepsByRole['hauler.relay'], creep => creep.memory.sourceRoom === room.name);
		const currentCarryParts = _.sum(_.map(currentHaulers, creep => creep.getActiveBodyparts(CARRY)));

		if (currentCarryParts >= currentlyNeededCarryParts) return;

		// @todo Reduce needed carry parts to account for energy spent on road maintenance.
		// @todo Reduce needed carry parts to account for higher throughput with relays.
		const maximumNeededCarryParts = this.getMaximumCarryParts(room);
		const maxHaulerSize = this.getMaximumHaulerSize(room, maximumNeededCarryParts);

		options.push({
			unitType: 'hauler',
			size: maxHaulerSize,
			priority: 3,
			weight: 0,
		})
	}

	getNeededCarryParts(room: Room): number {
		let total = 0;
		for (const position of this.getActiveRemoteHarvestPositions(room)) {
			const operation = Game.operationsByType.mining['mine:' + position.roomName];

			const targetPos = encodePosition(position);
			if (!operation.hasActiveHarvesters(targetPos)) continue;

			const paths = operation.getPaths();
			total += paths[targetPos].requiredCarryParts;
		}

		return total;
	}

	getMaximumCarryParts(room: Room): number {
		let total = 0;
		for (const position of this.getActiveRemoteHarvestPositions(room)) {
			const operation = Game.operationsByType.mining['mine:' + position.roomName];

			const paths = operation.getPaths();
			const targetPos = encodePosition(position);
			total += paths[targetPos].requiredCarryParts;
		}

		return total;
	}

	getMaximumHaulerSize(room: Room, maximumNeededCarryParts: number) {
		const maximumBody = this.generateCreepBodyFromWeights(
			room.storage ? this.getBodyWeights() : this.getNoRoadsBodyWeights(),
			room.energyCapacityAvailable,
			{[CARRY]: maximumNeededCarryParts},
		);
		const maxCarryPartsOnBiggestBody = _.countBy(maximumBody)[CARRY];
		const maxCarryPartsToEmptyContainer = Math.ceil(0.9 * CONTAINER_CAPACITY / CARRY_CAPACITY);
		const maxCarryParts = Math.min(maxCarryPartsOnBiggestBody, maxCarryPartsToEmptyContainer);
		const maxHaulers = Math.ceil(maximumNeededCarryParts / maxCarryParts);
		const adjustedCarryParts = Math.ceil(maximumNeededCarryParts / maxHaulers);

		return adjustedCarryParts;
	}

	getActiveRemoteHarvestPositions(room: Room): RoomPosition[] {
		return _.filter(room.getRemoteHarvestSourcePositions(), position => {
			const operation = Game.operationsByType.mining['mine:' + position.roomName];

			// Don't spawn if enemies are in the room.
			if (!operation) return false;
			if (operation.isUnderAttack()) return false;
			const targetPos = encodePosition(position);
			if (operation.needsDismantler(targetPos)) return false;

			const paths = operation.getPaths();
			if (!paths[targetPos]?.travelTime) return false;

			return true;
		});
	}

	addBuilderSpawnOptions(room: Room, options: RemoteMiningSpawnOption[]) {
		if (options.length > 0) return;

		//@todo
	}

	addClaimerSpawnOptions(room: Room, options: RemoteMiningSpawnOption[]) {
		if (options.length > 0) return;

		// Only spawn claimers if they can have 2 or more claim parts.
		if (room.energyCapacityAvailable < 2 * (BODYPART_COST[CLAIM] + BODYPART_COST[MOVE])) return;

		const reservePositions = room.getRemoteReservePositions();
		for (const pos of reservePositions) {
			const operation = Game.operationsByType.mining['mine:' + pos.roomName];

			// Don't spawn if enemies are in the room.
			// @todo Or in any room on the route, actually.
			if (!operation || operation.needsDismantler()) continue;
			if (operation.isUnderAttack()) {
				const totalEnemyData = operation.getTotalEnemyData();
				const isInvaderCore = totalEnemyData.damage === 0 && totalEnemyData.heal === 0;
				if (!isInvaderCore) continue;
			}

			if (!operation.hasActiveHarvesters()) continue;

			const pathLength = operation.getPaths()?.[encodePosition(pos)]?.path.length || 50;
			const RemoteMiningSpawnTime = this.getClaimerCreepBody(room).length * CREEP_SPAWN_TIME;
			const claimers = _.filter(
				Game.creepsByRole.claimer || {},
				(creep: ClaimerCreep) =>
					creep.memory.mission === 'reserve' && creep.memory.target === encodePosition(pos) &&
					creep.ticksToLive > pathLength + RemoteMiningSpawnTime
			);
			if (_.size(claimers) > 0) continue;

			const roomMemory = Memory.rooms[pos.roomName];
			if (roomMemory?.lastClaim) {
				const remainingReservation = roomMemory.lastClaim.time + roomMemory.lastClaim.value - Game.time;
				if (remainingReservation - RemoteMiningSpawnTime - pathLength > CONTROLLER_RESERVE_MAX * 0.5) continue;
			}

			// Don't spawn if enemies are in the room.
			// @todo Or in any room on the route, actually.
			if (roomMemory && roomMemory.enemies && !roomMemory.enemies.safe) continue;

			options.push({
				unitType: 'claimer',
				priority: 3,
				weight: 1,
				targetPos: pos,
			});
		}
	}

	addHarvesterSpawnOptions(room: Room, options: RemoteMiningSpawnOption[]) {
		if (options.length > 0) return;

		const harvestPositions = room.getRemoteHarvestSourcePositions();
		for (const position of harvestPositions) {
			this.addOptionForPosition(room, position, options);
		}
	}

	addOptionForPosition(room: Room, position: RoomPosition, options: RemoteMiningSpawnOption[]) {
		const targetPos = encodePosition(position);
		const operation = Game.operationsByType.mining['mine:' + position.roomName];

		// Don't spawn if enemies are in the room.
		if (!operation || operation.isUnderAttack() || operation.needsDismantler(targetPos)) return;

		// Don't spawn if there is no full path.
		const paths = operation.getPaths();
		const path = paths[targetPos];
		const travelTime = path?.travelTime;
		if (!travelTime) return;

		const option: HarvesterSpawnOption = {
			unitType: 'harvester',
			priority: 3,
			weight: 1,
			targetPos: position,
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
	getCreepBody(room: Room, option: RemoteMiningSpawnOption): BodyPartConstant[] {
		switch (option.unitType) {
			case 'claimer':
				return this.getClaimerCreepBody(room);
			case 'harvester':
				return this.getHarvesterCreepBody(room, option);
			case 'hauler':
				return this.getHaulerCreepBody(room, option);
			default:
				const exhaustiveCheck: never = option;
				throw new Error('Unknown unit type!');
		}
	}

	getClaimerCreepBody(room: Room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [CLAIM]: 0.5},
			room.energyCapacityAvailable,
			{[CLAIM]: 5},
		);
	}

	getHarvesterCreepBody(room: Room, option: HarvesterSpawnOption): BodyPartConstant[] {
		// @todo Also use high number of work parts if road still needs to be built.
		// @todo Use calculated max size like normal harvesters when established.
		// Use less move parts if a road has already been established.
		const bodyWeights = option.isEstablished ? {[MOVE]: 0.35, [WORK]: 0.65} : {[MOVE]: 0.5, [WORK]: 0.5, [CARRY]: 0.1};

		return this.generateCreepBodyFromWeights(
			bodyWeights,
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
			{[WORK]: option.size},
		);
	}

	getHaulerCreepBody(room: Room, option: HaulerSpawnOption): BodyPartConstant[] {
		return this.generateCreepBodyFromWeights(
			room.controller.level > 3 && room.storage ? this.getBodyWeights() : this.getNoRoadsBodyWeights(),
			room.energyCapacityAvailable,
			{[CARRY]: option.size},
		);
	}

	getBodyWeights(): Partial<Record<BodyPartConstant, number>> {
		return {[MOVE]: 0.35, [CARRY]: 0.65};
	}

	getNoRoadsBodyWeights(): Partial<Record<BodyPartConstant, number>> {
		return {[MOVE]: 0.5, [CARRY]: 0.5};
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
	getCreepMemory(room: Room, option: RemoteMiningSpawnOption): CreepMemory {
		switch (option.unitType) {
			case 'claimer':
				return {
					role: 'claimer',
					target: encodePosition(option.targetPos),
					mission: 'reserve',
					operation: 'mine:' + option.targetPos.roomName,
				} as ClaimerCreepMemory;
			case 'harvester':
				return {
					role: 'harvester.remote',
					source: encodePosition(option.targetPos),
					operation: 'mine:' + option.targetPos.roomName,
				} as RemoteHarvesterCreepMemory;
			case 'hauler':
				return {
					role: 'hauler.relay',
					room: room.name,
					delivering: true,
				} as RelayHaulerCreepMemory;
			default:
				const exhaustiveCheck: never = option;
				throw new Error('Unknown unit type!');
		}
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
	onSpawn(room: Room, option: RemoteMiningSpawnOption, body: BodyPartConstant[]) {
		if (!('targetPos' in option)) return;

		const operationName = 'mine:' + option.targetPos.roomName;
		const operation = Game.operations[operationName];
		if (!operation) return;

		operation.addResourceCost(this.calculateBodyCost(body), RESOURCE_ENERGY);
	}
}
