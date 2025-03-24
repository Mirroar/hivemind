/* global MOVE CLAIM BODYPART_COST CONTROLLER_RESERVE_MAX RESOURCE_ENERGY */

/**
 * General spawn order for remote mining creeps:
 * - For each source, in order of distance:
 *   - @todo Defenders (currently get spawned for any active source)
 *   - SK Killers @4.0 (or 1.0 for new rooms, to allow other creeps to spawn)
 *   - Haulers    @3.0 to satisfy current demand
 *   - Builders   @3.0 to satisfy current demand
 *   - Harvesters @3.x (or 1.x for new sources, to allow other creeps to spawn)
 *   - Claimers   @3.x
 */

import BodyBuilder, {MOVEMENT_MODE_PLAINS, MOVEMENT_MODE_ROAD} from 'creep/body-builder';
import hivemind from 'hivemind';
import SpawnRole from 'spawn-role/spawn-role';
import {decodePosition, encodePosition} from 'utils/serialization';
import {ENEMY_STRENGTH_NORMAL} from 'room-defense';
import {getRoomIntel} from 'room-intel';
import stats from 'utils/stats';
import cache from 'utils/cache';
import { getUsername } from 'utils/account';

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
			// @todo Don't stop remote mining if enemies are present.
			// Instead, check and only spawn these creeps for safe exits.
			if (room.defense.getEnemyStrength() >= ENEMY_STRENGTH_NORMAL) return [];

			// If we want to move a misplaced spawn, we need to stop spawning for a bit to focus on that.
			if (room.roomManager?.isMovingMisplacedSpawn()) return [];

			const options: RemoteMiningSpawnOption[] = [];

			let haulerDemand = 0;
			let builderDemand = 0;
			for (const position of room.getRemoteHarvestSourcePositions()) {
				this.registerPotentiallyActiveSource(room, position);

				if (!this.isAvailableRemote(position)) continue;

				this.addSkKillerSpawnOptions(room, options, position);
				if (options.length > 0) return options;

				haulerDemand += this.getHaulerDemand(position);
				this.addHaulerSpawnOptions(room, options, haulerDemand);
				if (options.length > 0) return options;

				builderDemand += this.getBuilderDemand(position);
				this.addBuilderSpawnOptions(room, options, builderDemand);
				if (options.length > 0) return options;

				this.addHarvesterSpawnOptions(room, options, position);
				if (options.length > 0) return options;

				this.addClaimerSpawnOptions(room, options, position);
				if (options.length > 0) return options;
			}

			return options;
		});
	}

	registerPotentiallyActiveSource(room:Room, position: RoomPosition) {
		// Keep a list of sources that are potentially active in cache.
		// This is used to determine what rooms we need to spawn defenders for.
		const roomList: Record<string, boolean> = cache.inHeap('activeRemoteRooms:' + room.name, 1, () => { return {}; });
		roomList[position.roomName] = true;
	}

	isAvailableRemote(position: RoomPosition): boolean {
		const targetPos = encodePosition(position);
		const operation = Game.operationsByType.mining['mine:' + position.roomName];

		// Don't spawn if enemies are in the room.
		if (!operation || operation.needsDismantler(targetPos)) return false;

		// Don't spawn if enemies are in the room or on the route.
		if (operation.isUnderAttack()) return false;

		const paths = operation.getPaths();
		const path = paths[targetPos];
		if (!path?.travelTime) return false;

		return true;
	}

	canUseRemoteDespiteInvaderCore(position: RoomPosition): boolean {
		const operation = Game.operationsByType.mining['mine:' + position.roomName];
		return operation.hasReservation();
	}

	getHaulerDemand(position: RoomPosition): number {
		const operation = Game.operationsByType.mining['mine:' + position.roomName];
		const paths = operation.getPaths();
		const targetPos = encodePosition(position);
		if (!operation.hasContainer(targetPos)) return 0;

		return paths[targetPos]?.requiredCarryParts || 0;
	}

	getBuilderDemand(position: RoomPosition): number {
		const operation = Game.operationsByType.mining['mine:' + position.roomName];

		const paths = operation.getPaths();
		const targetPos = encodePosition(position);
		if (!operation.hasActiveHarvesters(targetPos)) return 0;

		return operation.needsRepairs(targetPos) ? operation.estimateRequiredWorkPartsForMaintenance(targetPos) : 0;
	}

	addHaulerSpawnOptions(room: Room, options: RemoteMiningSpawnOption[], haulerDemand: number) {
		const {currentCarryParts, maxHaulerSize} = cache.inObject(room, 'remoteMiningHaulerData', 1, () => {
			// @todo Reduce needed carry parts to account for higher throughput with relays.
			const maximumNeededCarryParts = this.getMaximumCarryParts(room);
			const maxHaulerSize = this.getMaximumHaulerSize(room, maximumNeededCarryParts);
			const haulerBody = this.getMaximumHaulerBody(room, maxHaulerSize);
			const haulerSpawnTime = (haulerBody?.length || 0) * CREEP_SPAWN_TIME;

			const currentHaulers = _.filter(Game.creepsByRole['hauler.relay'], creep =>
				creep.memory.sourceRoom === room.name
				&& (creep.spawning || creep.ticksToLive > haulerSpawnTime),
			);
			const currentCarryParts = _.sum(_.map(currentHaulers, creep => creep.getActiveBodyparts(CARRY)));

			return {currentCarryParts, maxHaulerSize};
		});

		if (currentCarryParts >= haulerDemand) return;

		options.push({
			unitType: 'hauler',
			size: maxHaulerSize,
			priority: 3,
			weight: 0,
		});
	}

	getMaximumCarryParts(room: Room): number {
		let total = 0;
		for (const position of this.getActiveRemoteHarvestPositions(room)) {
			const operation = Game.operationsByType.mining['mine:' + position.roomName];
			const roomIntel = getRoomIntel(position.roomName);

			// Don't spawn for SK rooms if SK killer is missing.
			if (roomIntel.isSourceKeeperRoom() && _.size(roomIntel.getStructures(STRUCTURE_KEEPER_LAIR)) > 0) {
				const hasSkKiller = _.some(Game.creepsByRole.skKiller, creep => creep.memory.targetRoom === position.roomName);
				if (!hasSkKiller) {
					continue;
				}
			}

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

	addBuilderSpawnOptions(room: Room, options: RemoteMiningSpawnOption[], builderDemand: number) {
		if (options.length > 0) return;
		if (!room.storage && !room.terminal) return;
		if (room.getEffectiveAvailableEnergy() < 5000) return;

		const currentWorkParts = cache.inObject(room, 'remoteMiningBuilderData', 1, () => {
			const currentBuilders = _.filter(Game.creepsByRole['builder.mines'], creep => creep.memory.sourceRoom === room.name);
			const currentWorkParts = _.sum(_.map(currentBuilders, creep => creep.getActiveBodyparts(WORK)));

			return currentWorkParts;
		});

		if (currentWorkParts >= builderDemand) return;

		const maximumNeededWorkParts = this.getMaximumWorkParts(room);
		options.push({
			unitType: 'builder',
			size: this.getMaximumBuilderSize(room, maximumNeededWorkParts),
			priority: 3,
			weight: 0,
		});
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

	addClaimerSpawnOptions(room: Room, options: RemoteMiningSpawnOption[], position: RoomPosition) {
		const roomIntel = getRoomIntel(position.roomName);
		if (!roomIntel.isClaimable()) return;

		// Only spawn claimers if they can have 2 or more claim parts.
		if (room.energyCapacityAvailable < 2 * (BODYPART_COST[CLAIM] + BODYPART_COST[MOVE])) {
			if (!this.maySpawnSmallClaimer(room, position)) return;
		}

		const operation = Game.operationsByType.mining['mine:' + position.roomName];

		// @todo Cache path for claimers, as well, to get an exact number.
		const pathLength: number = _.sample(operation.getPaths())?.path?.length || 50;
		const claimerBody = this.getClaimerCreepBody(room);
		const claimerSpawnTime = claimerBody.length * CREEP_SPAWN_TIME;
		const claimers = _.filter(
			Game.creepsByRole.claimer || {},
			(creep: ClaimerCreep) =>
				creep.memory.mission === 'reserve' && creep.memory.target && decodePosition(creep.memory.target).roomName === position.roomName,
		);
		const activeClaimersOnArrival = _.filter(claimers, creep => (creep.spawning || creep.ticksToLive > pathLength + claimerSpawnTime));
		if (activeClaimersOnArrival.length >= roomIntel.getControllerReservePositionCount()) return;

		const claimPartCount = _.filter(claimerBody, part => part === CLAIM).length;
		const effectiveLifetime = CREEP_CLAIM_LIFE_TIME - pathLength;
		const maxAdditionalReservation = (claimPartCount - 1) * effectiveLifetime;
		const roomMemory = Memory.rooms[position.roomName];
		const remainingReservation = roomMemory.lastClaim ? Math.max(0, roomMemory.lastClaim.value + (roomMemory.lastClaim.time - Game.time)) : 0;
		const extraReservation: number = _.sum(claimers, creep => (creep.spawning ? CREEP_CLAIM_LIFE_TIME : creep.ticksToLive) * creep.getActiveBodyparts(CLAIM));
		const reservationAtArrival = remainingReservation + extraReservation - claimerSpawnTime - pathLength;
		if (reservationAtArrival + maxAdditionalReservation > CONTROLLER_RESERVE_MAX) return;

		const controllerPosition = roomIntel.getControllerPosition();
		options.push({
			unitType: 'claimer',
			priority: 3,
			weight: 1 - (pathLength / 100),
			targetPos: controllerPosition,
		});
	}

	maySpawnSmallClaimer(room: Room, position: RoomPosition): boolean {
		if (room.energyCapacityAvailable < (BODYPART_COST[CLAIM] + BODYPART_COST[MOVE])) return false;

		// We can spawn 1 part claimners if the controller has multiple
		// spots around it, or we need to get rid of an invader's reservation.
		const roomIntel = getRoomIntel(position.roomName);
		if (roomIntel.getControllerReservePositionCount() > 1) return true;

		const reservation = roomIntel.getReservationStatus();
		if (reservation && reservation.username !== getUsername() && reservation.ticksToEnd > 0) return true;

		return false;
	}

	addSkKillerSpawnOptions(room: Room, options: RemoteMiningSpawnOption[], position: RoomPosition) {
		const roomName = position.roomName;
		const roomIntel = getRoomIntel(roomName);
		if (!roomIntel.isSourceKeeperRoom()) return;
		if (_.size(roomIntel.getStructures(STRUCTURE_KEEPER_LAIR)) == 0) return;

		const currentCreeps = _.filter(Game.creepsByRole.skKiller, creep => creep.memory.targetRoom === roomName) as SkKillerCreep[];
		const isActiveRoom = _.some(Game.creepsByRole['harvester.remote'], creep => creep.memory.operation === 'mine:' + roomName)
			|| _.some(Game.creepsByRole['harvester.sk-mining'], (creep: RemoteHarvesterCreep) => decodePosition(creep.memory.source).roomName ===  roomName);

		// Don't spawn if there is no full path.
		const operation = Game.operationsByType.mining['mine:' + roomName];
		const paths = operation.getPaths();
		const travelTime = _.min(_.map(paths, path => path.travelTime ?? 500));
		const option: SkKillerSpawnOption = {
			unitType: 'skKiller',
			priority: isActiveRoom ? 4 : 1,
			weight: 1 - (travelTime / 100),
			targetRoom: roomName,
		};

		const body = this.getCreepBody(room, option);
		if (!body || body.length < MAX_CREEP_SIZE) return;

		const creepSpawnTime = body.length * CREEP_SPAWN_TIME;
		const activeSkKillers: SkKillerCreep[] = _.filter(
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

	addHarvesterSpawnOptions(room: Room, options: RemoteMiningSpawnOption[], position: RoomPosition) {
		const targetPos = encodePosition(position);
		const operation = Game.operationsByType.mining['mine:' + position.roomName];
		const isActiveRoom = _.some(Game.creepsByRole['harvester.remote'], (creep: RemoteHarvesterCreep) => creep.memory.source === targetPos);

		if (operation.hasInvaderCore() && !this.canUseRemoteDespiteInvaderCore(position)) {
			return;
		}

		// Don't spawn if room is reserved by enemies.
		const roomIntel = getRoomIntel(position.roomName);
		const reservation = roomIntel.getReservationStatus();
		if (reservation && reservation.username !== getUsername() && reservation.ticksToEnd > CONTROLLER_RESERVE_MAX / 10) return;

		// Don't spawn in SK rooms if SK killer is missing.
		if (roomIntel.isSourceKeeperRoom() && _.size(roomIntel.getStructures(STRUCTURE_KEEPER_LAIR)) > 0) {
			const hasSkKiller = _.some(Game.creepsByRole.skKiller, creep => creep.memory.targetRoom === position.roomName);
			if (!hasSkKiller) {
				hivemind.log('creeps', room.name).debug('Not spawning harvester because we don\'t have any SK killers.');
				return;
			}
		}

		// Don't spawn if there is no full path.
		const paths = operation.getPaths();
		const path = paths[targetPos];
		const travelTime = path.travelTime;
		const container = operation.getContainer(targetPos);
		const isEstablished = operation.hasContainer(targetPos) && (container?.hits || CONTAINER_HITS) > CONTAINER_HITS / 2;

		const option: HarvesterSpawnOption = {
			unitType: 'harvester',
			priority: 1,
			weight: 1 - (travelTime / 100),
			targetPos: position,
			// @todo Consider established when roads are fully built.
			isEstablished,
			size: (operation.getHarvesterSize(targetPos) || 0) * this.getHarvesterSizeFactor(room),
		};

		if (isActiveRoom) option.priority += 2;

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
		) as HarvesterCreep[];

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
			.setWeights({[WORK]: 20, [CARRY]: (option.isEstablished && room.controller.level >= 6) ? 0 : 1})
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
