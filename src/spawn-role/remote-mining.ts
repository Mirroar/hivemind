/* global MOVE CLAIM BODYPART_COST CONTROLLER_RESERVE_MAX RESOURCE_ENERGY */

import BodyBuilder, {MOVEMENT_MODE_PLAINS, MOVEMENT_MODE_ROAD} from 'creep/body-builder';
import hivemind from 'hivemind';
import settings from 'settings-manager';
import SpawnRole from 'spawn-role/spawn-role';
import {encodePosition} from 'utils/serialization';
import {ENEMY_STRENGTH_NORMAL} from 'room-defense';
import {getRoomIntel} from 'room-intel';

interface BuilderSpawnOption extends SpawnOption {
	unitType: 'builder';
	size: number;
}

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

interface SkKillerSpawnOption extends SpawnOption {
	unitType: 'skKiller';
	targetRoom: string;
}

type RemoteMiningSpawnOption = BuilderSpawnOption
| ClaimerSpawnOption
| HarvesterSpawnOption
| HaulerSpawnOption
| SkKillerSpawnOption;

export default class RemoteMiningSpawnRole extends SpawnRole {
	/**
	 * Adds claimer spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): RemoteMiningSpawnOption[] {
		return this.cacheEmptySpawnOptionsFor(room, 10, () => {
			if (room.defense.getEnemyStrength() >= ENEMY_STRENGTH_NORMAL) return [];

			// If we want to move a misplaced spawn, we need to stop spawning for a bit.
			if (room.roomManager?.hasMisplacedSpawn()) return [];

			const options: RemoteMiningSpawnOption[] = [];

			this.addHaulerSpawnOptions(room, options);
			this.addBuilderSpawnOptions(room, options);
			this.addClaimerSpawnOptions(room, options);
			this.addHarvesterSpawnOptions(room, options);
			this.addSkKillerSpawnOptions(room, options);

			return options;
		});
	}

	addHaulerSpawnOptions(room: Room, options: RemoteMiningSpawnOption[]) {
		// @todo Reduce needed carry parts to account for energy spent on road maintenance.
		// @todo Reduce needed carry parts to account for higher throughput with relays.
		const maximumNeededCarryParts = this.getMaximumCarryParts(room);
		const maxHaulerSize = this.getMaximumHaulerSize(room, maximumNeededCarryParts);
		const hasRoads = room.controller.level > 3 && (room.storage || room.terminal);
		const haulerBody = this.getMaximumHaulerBody(room, maxHaulerSize);
		const haulerSpawnTime = (haulerBody?.length || 0) * CREEP_SPAWN_TIME;

		const currentlyNeededCarryParts = this.getNeededCarryParts(room);
		const currentHaulers = _.filter(Game.creepsByRole['hauler.relay'], creep =>
			creep.memory.sourceRoom === room.name
			&& (creep.spawning || creep.ticksToLive > haulerSpawnTime),
		);
		const currentCarryParts = _.sum(_.map(currentHaulers, creep => creep.getActiveBodyparts(CARRY)));

		if (currentCarryParts >= currentlyNeededCarryParts) return;

		options.push({
			unitType: 'hauler',
			size: maxHaulerSize,
			priority: 3,
			weight: 0,
		});
	}

	getNeededCarryParts(room: Room): number {
		let total = 0;
		for (const position of this.getActiveRemoteHarvestPositions(room)) {
			const operation = Game.operationsByType.mining['mine:' + position.roomName];

			const targetPos = encodePosition(position);
			if (!operation.hasActiveHarvesters(targetPos)) continue;
			if (!operation.hasContainer(targetPos)) continue;

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

	getMaximumHaulerBody(room: Room, maximumCarryParts: number) {
		const hasRoads = room.controller.level > 3 && (room.storage || room.terminal);

		return (new BodyBuilder())
			.setWeights({[CARRY]: 1})
			.setPartLimit(CARRY, maximumCarryParts)
			.setMovementMode(hasRoads ? MOVEMENT_MODE_ROAD : MOVEMENT_MODE_PLAINS)
			.setEnergyLimit(room.energyCapacityAvailable)
			.build();
	}

	getMaximumHaulerSize(room: Room, maximumNeededCarryParts: number) {
		const maximumBody = this.getMaximumHaulerBody(room, maximumNeededCarryParts);
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
		if (!room.storage && !room.terminal) return;

		const currentlyNeededWorkParts = this.getNeededWorkParts(room);
		const currentBuilders = _.filter(Game.creepsByRole['builder.mines'], creep => creep.memory.sourceRoom === room.name);
		const currentWorkParts = _.sum(_.map(currentBuilders, creep => creep.getActiveBodyparts(WORK)));

		if (currentWorkParts >= currentlyNeededWorkParts) return;

		const maximumNeededWorkParts = this.getMaximumWorkParts(room);
		const maxBuilderSize = this.getMaximumBuilderSize(room, maximumNeededWorkParts);

		options.push({
			unitType: 'builder',
			size: maxBuilderSize,
			priority: 3,
			weight: 0,
		});
	}

	getNeededWorkParts(room: Room): number {
		let total = 0;
		for (const position of this.getActiveRemoteHarvestPositions(room)) {
			const operation = Game.operationsByType.mining['mine:' + position.roomName];

			const targetPos = encodePosition(position);
			if (!operation.hasActiveHarvesters(targetPos)) continue;

			total += operation.needsRepairs(targetPos) ? operation.estimateRequiredWorkPartsForMaintenance(targetPos) : 0;
		}

		return total;
	}

	getMaximumWorkParts(room: Room): number {
		let total = 0;
		for (const position of this.getActiveRemoteHarvestPositions(room)) {
			const operation = Game.operationsByType.mining['mine:' + position.roomName];
			const targetPos = encodePosition(position);
			total += operation.estimateRequiredWorkPartsForMaintenance(targetPos);
		}

		return total;
	}

	getMaximumBuilderSize(room: Room, maximumNeededWorkParts: number) {
		const hasRoads = room.controller.level > 3 && (room.storage || room.terminal);
		const maximumBody = (new BodyBuilder())
			.setWeights({[CARRY]: 5, [WORK]: 2})
			.setPartLimit(WORK, maximumNeededWorkParts)
			.setMovementMode(hasRoads ? MOVEMENT_MODE_ROAD : MOVEMENT_MODE_PLAINS)
			.setEnergyLimit(room.energyCapacityAvailable)
			.build();
		const maxWorkParts = _.countBy(maximumBody)[WORK];
		const maxBuilders = Math.ceil(maximumNeededWorkParts / maxWorkParts);
		const adjustedWorkParts = Math.ceil(maximumNeededWorkParts / maxBuilders);

		return adjustedWorkParts;
	}

	addClaimerSpawnOptions(room: Room, options: RemoteMiningSpawnOption[]) {
		if (options.length > 0) return;

		// Only spawn claimers if they can have 2 or more claim parts.
		// @todo We could even do it with 1 part if the controller has multiple
		// spots around it.
		if (room.energyCapacityAvailable < 2 * (BODYPART_COST[CLAIM] + BODYPART_COST[MOVE])) return;

		const reservePositions = room.getRemoteReservePositions();
		for (const pos of reservePositions) {
			const operation = Game.operationsByType.mining['mine:' + pos.roomName];

			// Don't spawn if enemies are in the room or on the route.
			if (!operation || operation.needsDismantler()) continue;
			if (operation.isUnderAttack()) {
				const totalEnemyData = operation.getTotalEnemyData();
				const isInvaderCore = totalEnemyData.damage === 0 && totalEnemyData.heal === 0;
				if (!isInvaderCore) continue;
			}

			if (!operation.hasActiveHarvesters()) continue;

			// @todo Cache path for claimers, as well, to get an exact number.
			const pathLength = _.sample(operation.getPaths())?.path.length || 50;
			const claimerBody = this.getClaimerCreepBody(room);
			const claimerSpawnTime = claimerBody.length * CREEP_SPAWN_TIME;
			const claimers = _.filter(
				Game.creepsByRole.claimer || {},
				(creep: ClaimerCreep) =>
					creep.memory.mission === 'reserve' && creep.memory.target === encodePosition(pos),
			);
			const activeClaimersOnArrival = _.filter(claimers, creep => (creep.spawning || creep.ticksToLive > pathLength + claimerSpawnTime));
			if (activeClaimersOnArrival.length > 0) continue;

			const roomMemory = Memory.rooms[pos.roomName];
			if (roomMemory?.lastClaim) {
				const claimPartCount = _.filter(claimerBody, part => part === CLAIM).length;
				const effectiveLifetime = CREEP_CLAIM_LIFE_TIME - pathLength;
				const maxAdditionalReservation = (claimPartCount - 1) * effectiveLifetime;
				const remainingReservation = roomMemory.lastClaim.value + (roomMemory.lastClaim.time - Game.time);
				const extraReservation = _.sum(claimers, creep => Math.min(creep.ticksToLive || CREEP_CLAIM_LIFE_TIME, pathLength + claimerSpawnTime) * creep.getActiveBodyparts(CLAIM));
				const reservationAtArrival = remainingReservation - claimerSpawnTime - pathLength + extraReservation;
				if (reservationAtArrival + maxAdditionalReservation > CONTROLLER_RESERVE_MAX) continue;
			}

			options.push({
				unitType: 'claimer',
				priority: 3,
				weight: 1 - (pathLength / 100),
				targetPos: pos,
			});
		}
	}

	addSkKillerSpawnOptions(room: Room, options: RemoteMiningSpawnOption[]) {
		if (room.controller.level < 7) return;
		// @todo Make sure we can spawn a strong enough SK killer (maybe we
		// don't have all extensions, yet)
		// @todo We could spawn a SK killer duo at RCL 6.

		const harvestPositions = room.getRemoteHarvestSourcePositions();
		const considered = {};
		for (const position of harvestPositions) {
			// Call only once per room.
			if (considered[position.roomName]) continue;

			considered[position.roomName] = true;
			this.addSkKillerOptionForPosition(room, position.roomName, options);
		}
	}

	addSkKillerOptionForPosition(room: Room, roomName: string, options: RemoteMiningSpawnOption[]) {
		const roomIntel = getRoomIntel(roomName);
		if (roomIntel.isClaimable()) return;
		if (_.size(roomIntel.getStructures(STRUCTURE_KEEPER_LAIR)) == 0) return;

		const currentCreeps = _.filter(Game.creepsByRole.skKiller, creep => creep.memory.targetRoom === roomName);
		const isActiveRoom = _.some(Game.creepsByRole['harvester.remote'], creep => creep.memory.targetRoom === roomName);

		// Only start claiming a new SK room when there's nothing more important
		// to spawn.
		if (!isActiveRoom && options.length > 0) return;

		// Don't spawn if there is no full path.
		const operation = Game.operationsByType.mining['mine:' + roomName];
		const paths = operation.getPaths();
		const travelTime = _.min(_.map(paths, path => path.travelTime ?? 500));
		if (!travelTime) return;

		const option: SkKillerSpawnOption = {
			unitType: 'skKiller',
			priority: isActiveRoom ? 4 : 1,
			weight: 1 - (travelTime / 100),
			targetRoom: roomName,
		};

		const body = this.getCreepBody(room, option);
		if (!body || body.length < MAX_CREEP_SIZE) return;

		const creepSpawnTime = body.length * CREEP_SPAWN_TIME;
		const activeSkKillers = _.filter(
			currentCreeps,
			(creep: SkKillerCreep) => {
				// @todo Instead of filtering for every room, this could be grouped once per tick.
				if (creep.spawning) return true;
				if (creep.ticksToLive > Math.min(travelTime + creepSpawnTime + 100, 600)) return true;

				return false;
			},
		);
		if (activeSkKillers.length > 0) return;

		options.push(option);
	}

	addHarvesterSpawnOptions(room: Room, options: RemoteMiningSpawnOption[]) {
		const harvestPositions = room.getRemoteHarvestSourcePositions();
		for (const position of harvestPositions) {
			this.addHarvesterOptionForPosition(room, position, options);
		}
	}

	addHarvesterOptionForPosition(room: Room, position: RoomPosition, options: RemoteMiningSpawnOption[]) {
		const targetPos = encodePosition(position);
		const operation = Game.operationsByType.mining['mine:' + position.roomName];

		// Don't spawn if enemies are in the room.
		if (!operation || operation.isUnderAttack() || operation.needsDismantler(targetPos)) return;

		const isActiveRoom = _.some(Game.creepsByRole['harvester.remote'], (creep: RemoteHarvesterCreep) => creep.memory.source === targetPos);

		// Only start claiming a new remote when there's nothing more important
		// to spawn.
		if (!isActiveRoom && options.length > 0) return;

		// Don't spawn in SK rooms if SK killer is missing.
		const roomIntel = getRoomIntel(position.roomName);
		if (!roomIntel.isClaimable() && _.size(roomIntel.getStructures(STRUCTURE_KEEPER_LAIR)) > 0) {
			const hasSkKiller = _.some(Game.creepsByRole.skKiller, creep => creep.memory.targetRoom === position.roomName);
			if (!hasSkKiller) {
				hivemind.log('creeps', room.name).debug('Not spawning harvester because we don\'t have any SK killers.');
				return;
			}
		}

		// Don't spawn if there is no full path.
		const paths = operation.getPaths();
		const path = paths[targetPos];
		const travelTime = path?.travelTime;
		if (!travelTime) return;

		const container = operation.getContainer(targetPos);
		const isEstablished = operation.hasContainer(targetPos) && (container?.hits || CONTAINER_HITS) > CONTAINER_HITS / 2;

		// @todo Allow larger harvesters if we need CPU and have spawn time to spare.
		const sizeFactor = (room.controller.level === 8 ? 2
			: (room.controller.level === 7 ? 1.8
				: (room.controller.level === 6 ? 1.5 : 1)));

		const option: HarvesterSpawnOption = {
			unitType: 'harvester',
			priority: 1,
			weight: 1 - (travelTime / 100),
			targetPos: position,
			// @todo Consider established when roads are fully built.
			isEstablished,
			size: (operation.getHarvesterSize(targetPos) || 0) * sizeFactor,
		};

		if (isActiveRoom) option.priority++;

		const roomMemory = Memory.rooms[position.roomName];
		if (roomMemory.lastClaim) {
			const remainingReservation = roomMemory.lastClaim.value + (roomMemory.lastClaim.time - Game.time);
			if (remainingReservation > travelTime) option.priority++;
		}

		const creepSpawnTime = this.getCreepBody(room, option)?.length * CREEP_SPAWN_TIME || 0;
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
		let freeSpots = 1;
		for (const source of roomIntel.getSourcePositions()) {
			if (source.x === position.x && source.y === position.y) freeSpots = source.free || 1;
		}

		if (harvesters.length >= freeSpots) return;
		const requestedSaturation = operation.hasContainer(targetPos) || room.controller.level > 5 ? 0.9 : ((BUILD_POWER + HARVEST_POWER) / BUILD_POWER);
		const workParts = _.sum(harvesters, creep => creep.getActiveBodyparts(WORK));
		if (workParts >= operation.getHarvesterSize(targetPos) * requestedSaturation) return;

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
			case 'builder':
				return this.getBuilderCreepBody(room, option);
			case 'claimer':
				return this.getClaimerCreepBody(room);
			case 'harvester':
				return this.getHarvesterCreepBody(room, option);
			case 'hauler':
				return this.getHaulerCreepBody(room, option);
			case 'skKiller':
				return this.getSkKillerCreepBody(room, option);
			default:
				const exhaustiveCheck: never = option;
				throw new Error('Unknown unit type!');
		}
	}

	getClaimerCreepBody(room: Room) {
		return (new BodyBuilder())
			.setWeights({[CLAIM]: 1})
			// We could do 1 more claim part, since controller loses 1
			// reservation each tick, but then we risk spawning claimers too late.
			.setPartLimit(CLAIM, Math.floor(CONTROLLER_RESERVE_MAX / CREEP_CLAIM_LIFE_TIME))
			.setEnergyLimit(room.energyCapacityAvailable)
			.build();
	}

	getHarvesterCreepBody(room: Room, option: HarvesterSpawnOption): BodyPartConstant[] {
		return (new BodyBuilder())
			.setWeights({[WORK]: 20, [CARRY]: (option.isEstablished && room.controller.level < 7) ? 0 : 1})
			.setPartLimit(WORK, option.size > 0 ? option.size + 1 : 0)
			.setMovementMode(option.isEstablished ? MOVEMENT_MODE_ROAD : MOVEMENT_MODE_PLAINS)
			.setCarryContentLevel(0)
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
			.build();
	}

	getHaulerCreepBody(room: Room, option: HaulerSpawnOption): BodyPartConstant[] {
		const hasRoads = room.controller.level > 3 && (room.storage || room.terminal);

		return (new BodyBuilder())
			.setWeights({[CARRY]: 1})
			.setPartLimit(CARRY, option.size)
			.setMovementMode(hasRoads ? MOVEMENT_MODE_ROAD : MOVEMENT_MODE_PLAINS)
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
			.build();
	}

	getBuilderCreepBody(room: Room, option: BuilderSpawnOption): BodyPartConstant[] {
		const hasRoads = room.controller.level > 3 && (room.storage || room.terminal);

		return (new BodyBuilder())
			.setWeights({[CARRY]: 5, [WORK]: 2})
			.setPartLimit(WORK, option.size)
			.setMovementMode(hasRoads ? MOVEMENT_MODE_ROAD : MOVEMENT_MODE_PLAINS)
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
			.build();
	}

	getSkKillerCreepBody(room: Room, option: SkKillerSpawnOption): BodyPartConstant[] {
		return (new BodyBuilder())
			.setWeights({[ATTACK]: 4, [HEAL]: 1})
			.setMovementMode(MOVEMENT_MODE_PLAINS)
			.setMoveBufferRatio(1)
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
	getCreepMemory(room: Room, option: RemoteMiningSpawnOption): CreepMemory {
		switch (option.unitType) {
			case 'builder':
				return {
					role: 'builder.mines',
					returning: true,
					sourceRoom: room.name,
				} as MineBuilderCreepMemory;
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
					sourceRoom: room.name,
					delivering: true,
				} as RelayHaulerCreepMemory;
			case 'skKiller':
				return {
					role: 'skKiller',
					sourceRoom: room.name,
					targetRoom: option.targetRoom,
					operation: 'mine:' + option.targetRoom,
				} as SkKillerCreepMemory;
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
		// @todo Also count cost of sk killer creeps.
		if (!('targetPos' in option)) return;

		const operationName = 'mine:' + option.targetPos.roomName;
		const operation = Game.operations[operationName];
		if (!operation) return;

		operation.addResourceCost(this.calculateBodyCost(body), RESOURCE_ENERGY);
	}
}
