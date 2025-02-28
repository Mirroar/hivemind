/* global RoomPosition MOVE ATTACK HEAL RANGED_ATTACK ATTACK_POWER
RANGED_ATTACK_POWER HEAL_POWER RESOURCE_ENERGY */

import BodyBuilder from 'creep/body-builder';
import cache from 'utils/cache';
import hivemind from 'hivemind';
import NavMesh from 'utils/nav-mesh';
import SpawnRole from 'spawn-role/spawn-role';
import {encodePosition, decodePosition} from 'utils/serialization';
import { has } from 'lodash';

interface BrawlerSpawnOption extends SpawnOption {
	targetPos?: string;
	pathTarget?: string;
	responseType?: number;
	operation?: string;
	trainStarter?: Id<Creep>;
	segmentType?: number;
}

declare global {
	interface RoomMemory {
		recentBrawler?: Record<string, number>;
	}
}

const RESPONSE_NONE = 0;
const RESPONSE_MINI_BRAWLER = 1;
const RESPONSE_MINI_BLINKY = 11;
const RESPONSE_FULL_BRAWLER = 2;
const RESPONSE_BLINKY = 3;
const RESPONSE_ATTACK_HEAL_TRAIN = 4;
const RESPONSE_ATTACK_BLINKY_TRAIN = 5;
const RESPONSE_RANGED_HEAL_TRAIN = 6;
const RESPONSE_RANGED_BLINKY_TRAIN = 7;
const RESPONSE_BLINKY_BLINKY_TRAIN = 8;
const RESPONSE_BLINKY_HEAL_TRAIN = 9;
const RESPONSE_ATTACKER = 10;

const SEGMENT_HEAL = 1;
const SEGMENT_BLINKY = 2;

export default class BrawlerSpawnRole extends SpawnRole {
	navMesh: NavMesh;

	/**
	 * Adds brawler spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): BrawlerSpawnOption[] {
		return this.cacheEmptySpawnOptionsFor(room, 10, () => {
			const options: BrawlerSpawnOption[] = [];
			this.getRemoteDefenseSpawnOptions(room, options);
			this.getPowerHarvestDefenseSpawnOptions(room, options);
			this.getTrainPartSpawnOptions(room, options);

			// @todo Move reclaiming to a separate spawn role.
			this.getReclaimSpawnOptions(room, options);

			return options;
		});
	}

	/**
	 * Adds brawler spawn options for remote harvest rooms.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getRemoteDefenseSpawnOptions(room: Room, options: BrawlerSpawnOption[]) {
		const harvestPositions: RoomPosition[] = room.getRemoteHarvestSourcePositions();
		for (const pos of harvestPositions) {
			const operation = Game.operationsByType.mining['mine:' + pos.roomName];

			// @todo If the operation has multiple source rooms, use the one
			// that has better spawn capacity or higher RCL.

			// Only spawn if there are enemies.
			if (!operation) continue;
			if (!operation.isUnderAttack() && !operation.hasInvaderCore()) continue;

			// Only do costly defense if we have enough energy.
			if (operation.isUnderAttack() && room.getEffectiveAvailableEnergy() < 5_000) return;

			// Don't defend operations where we still need a dismantler.
			if (operation.isUnderAttack() && operation.needsDismantler()) continue;

			// Only spawn defenders for actively used sources.
			if (!this.isActivelyUsedSource(room, pos)) continue;

			// Don't spawn simple source defenders in quick succession.
			// If they fail, there's a stronger enemy that we need to deal with
			// in a different way.
			const targetPos = encodePosition(new RoomPosition(25, 25, pos.roomName));
			const defenseTimeDiff = operation.isProfitable() ? 300 : 1500;
			if (room.memory.recentBrawler && Game.time - (room.memory.recentBrawler[targetPos] || -10_000) < defenseTimeDiff) continue;

			const brawlers = _.filter(Game.creepsByRole.brawler || [], (creep: BrawlerCreep) => creep.memory.operation === 'mine:' + pos.roomName);
			if (_.size(brawlers) > 0) continue;

			const totalEnemyData = operation.getTotalEnemyData();
			const responseType = this.getDefenseCreepSize(room, totalEnemyData);

			if (responseType === RESPONSE_NONE) continue;

			const sourceLocation = encodePosition(pos);
			options.push({
				priority: 3,
				weight: 1,
				targetPos,
				pathTarget: sourceLocation,
				responseType,
				operation: operation.name,
			});
		}
	}

	isActivelyUsedSource(room: Room, pos: RoomPosition): boolean {
		const roomList: Record<string, boolean> = cache.fromHeap('activeRemoteRooms:' + room.name, true);
		if (roomList?.[pos.roomName]) return true;

		const hasActiveHarvesters = _.some(Game.creepsByRole['harvester.remote'], (creep: RemoteHarvesterCreep) => decodePosition(creep.memory.source).roomName === pos.roomName);
		return hasActiveHarvesters;
	}

	getPowerHarvestDefenseSpawnOptions(room: Room, options: BrawlerSpawnOption[]) {
		if (!hivemind.settings.get('enablePowerMining')) return;
		if (!Memory.strategy || !Memory.strategy.power || !Memory.strategy.power.rooms) return;
		if (room.getEffectiveAvailableEnergy() < 10_000) return;

		_.each(Memory.strategy.power.rooms, (info, roomName) => {
			if (!info.isActive) return;
			if (!info.spawnRooms[room.name]) return;

			const roomMemory = Memory.rooms[roomName];
			if (!roomMemory || !roomMemory.enemies) return;
			if (roomMemory.enemies.safe) return;

			const brawlers = _.filter(Game.creepsByRole.brawler || [], creep => creep.memory.target && decodePosition(creep.memory.target).roomName === roomName);
			if (_.size(brawlers) > 0) return;

			// We don't care about melee attacks, plenty of attack creeps in the
			// room when we're harvesting power.
			const enemies = _.cloneDeep(roomMemory.enemies);
			// @todo Retain information about enemy boosts affecting damage.
			enemies.damage -= (enemies.parts[ATTACK] || 0) * ATTACK_POWER * 0.9;
			if (enemies.parts[ATTACK]) enemies.parts[ATTACK] *= 0.1;

			const responseType = this.getDefenseCreepSize(room, enemies);
			if (responseType === RESPONSE_NONE) return;

			options.push({
				priority: 4,
				weight: 1,
				targetPos: encodePosition(new RoomPosition(24, 24, roomName)),
				responseType,
			});
		});
	}

	getDefenseCreepSize(room: Room, enemyData: EnemyData): number {
		// Default defense creep has 4 attack and 3 heal parts.
		const defaultAttack = 5;
		const defaultHeal = 3;

		const defaultBlinkyAttack = 6;
		const defaultBlinkyHeal = 2;

		const meleeWithHealValue = 3;
		const healValue = 5;

		const enemyPower = enemyData.damage + (enemyData.heal * healValue);
		const isRangedEnemy = (enemyData.parts[RANGED_ATTACK] || 0) > 0;

		const smallDefenderPower = (defaultAttack * ATTACK_POWER) + (defaultHeal * HEAL_POWER * meleeWithHealValue);
		const smallBlinkyPower = (defaultBlinkyAttack * RANGED_ATTACK_POWER) + (defaultBlinkyHeal * HEAL_POWER * healValue);

		// Use a reasonable attacker for destroying invader cores.
		if (enemyData.hasInvaderCore && enemyPower < smallDefenderPower) {
			return RESPONSE_ATTACKER;
		}

		// For small attackers that should be defeated easily, use simple brawler.
		if (enemyPower < smallDefenderPower / 2 && !isRangedEnemy) {
			return RESPONSE_MINI_BRAWLER;
		}

		if (enemyPower < smallBlinkyPower) {
			return RESPONSE_MINI_BLINKY;
		}

		// If damage and heal suffices, use single melee / heal creep.
		// const brawlerBody = this.getBrawlerCreepBody(room);
		// const numberBrawlerAttack = _.filter(brawlerBody, p => p === ATTACK).length;
		// const numberBrawlerHeal = _.filter(brawlerBody, p => p === HEAL).length;
		// if (!isRangedEnemy && enemyPower < (numberBrawlerAttack * ATTACK_POWER) + (numberBrawlerHeal * HEAL_POWER * meleeWithHealValue)) {
		// 	return RESPONSE_FULL_BRAWLER;
		// }

		// If damage and heal suffices, use single range / heal creep.
		const blinkyBody = this.getBlinkyCreepBody(room);
		const numberBlinkyRanged = _.filter(blinkyBody, p => p === RANGED_ATTACK).length;
		const numberBlinkyHeal = _.filter(blinkyBody, p => p === HEAL).length;
		if (enemyPower < (numberBlinkyRanged * RANGED_ATTACK_POWER) + (numberBlinkyHeal * HEAL_POWER * healValue)) {
			return RESPONSE_BLINKY;
		}

		// If needed, use 2-creep train.
		const attackBody = this.getAttackCreepBody(room);
		const rangedBody = this.getRangedCreepBody(room);
		const healBody = this.getHealCreepBody(room);
		const numberTrainAttack = _.filter(attackBody, p => p === ATTACK).length;
		const numberTrainRanged = _.filter(rangedBody, p => p === RANGED_ATTACK).length;
		const numberTrainHeal = _.filter(healBody, p => p === HEAL).length;

		// if (!isRangedEnemy && enemyPower < (numberTrainAttack * ATTACK_POWER) + (numberTrainHeal * HEAL_POWER * healValue)) {
		// 	return RESPONSE_ATTACK_HEAL_TRAIN;
		// }

		if (!isRangedEnemy && enemyPower < (numberTrainAttack * ATTACK_POWER) + (numberBlinkyRanged * RANGED_ATTACK_POWER) + (numberBlinkyHeal * HEAL_POWER * healValue)) {
			return RESPONSE_ATTACK_BLINKY_TRAIN;
		}

		if (enemyPower < ((numberTrainRanged + numberBlinkyRanged) * RANGED_ATTACK_POWER) + (numberBlinkyHeal * HEAL_POWER * healValue)) {
			return RESPONSE_RANGED_BLINKY_TRAIN;
		}

		if (enemyPower < (2 * numberBlinkyRanged * RANGED_ATTACK_POWER) + (2 * numberBlinkyHeal * HEAL_POWER * healValue)) {
			return RESPONSE_BLINKY_BLINKY_TRAIN;
		}

		if (enemyPower < (numberTrainRanged * RANGED_ATTACK_POWER) + (numberTrainHeal * HEAL_POWER * healValue)) {
			return RESPONSE_RANGED_HEAL_TRAIN;
		}

		if (enemyPower < (numberBlinkyRanged * RANGED_ATTACK_POWER) + ((numberTrainHeal + numberBlinkyHeal) * HEAL_POWER * healValue)) {
			return RESPONSE_BLINKY_HEAL_TRAIN;
		}

		// @todo Otherwise, decide on spawning a quad, once we can use one.

		// If attacker too strong, don't spawn defense at all.
		return RESPONSE_NONE;
	}

	/**
	 * Spawns additional segments of a creep train.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getTrainPartSpawnOptions(room: Room, options: BrawlerSpawnOption[]) {
		const trainStarters = _.filter(room.creepsByRole.brawler || [], (creep: Creep) => creep.memory.train && _.size(creep.memory.train.partsToSpawn) > 0);

		for (const creep of trainStarters) {
			const segmentType = creep.memory.train.partsToSpawn[0];

			options.push({
				priority: 4,
				weight: 0,
				trainStarter: creep.id,
				segmentType,
			});
		}
	}

	getReclaimSpawnOptions(room: Room, options: BrawlerSpawnOption[]) {
		if (room.getEffectiveAvailableEnergy() < 10_000) return;

		for (const targetRoom of Game.myRooms) {
			if (room.name === targetRoom.name) continue;
			if (!this.canReclaimRoom(targetRoom, room)) continue;

			// @todo Only send brawlers when the room to reclaim might be
			// attacked.
			options.push({
				priority: 4,
				weight: 0,
				targetPos: encodePosition(targetRoom.roomPlanner.getRoomCenter()),
				responseType: RESPONSE_BLINKY,
			});
		}
	}

	canReclaimRoom(targetRoom: Room, room: Room): boolean {
		if (!targetRoom.needsReclaiming()) return false;
		if (!targetRoom.isSafeForReclaiming()) return false;
		if (!targetRoom.roomPlanner) return false;

		const remoteDefense = _.filter(Game.creepsByRole.brawler, (creep: Creep) => creep.memory.target === encodePosition(targetRoom.roomPlanner.getRoomCenter())).length;
		if (remoteDefense > 3) return false;

		const route = cache.inHeap('reclaimPath:' + targetRoom.name + '.' + room.name, 100, () => {
			if (!this.navMesh) this.navMesh = new NavMesh();
			return this.navMesh.findPath(room.roomPlanner.getRoomCenter(), targetRoom.roomPlanner.getRoomCenter(), {maxPathLength: 700});
		});
		if (route.incomplete) return false;

		return true;
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
	getCreepBody(room: Room, option: BrawlerSpawnOption): BodyPartConstant[] {
		if (option.responseType) {
			switch (option.responseType) {
				case RESPONSE_MINI_BRAWLER:
				case RESPONSE_FULL_BRAWLER:
					return this.getBrawlerCreepBody(room, option.responseType === RESPONSE_MINI_BRAWLER ? 5 : null);

				case RESPONSE_BLINKY:
				case RESPONSE_MINI_BLINKY:
				case RESPONSE_BLINKY_BLINKY_TRAIN:
				case RESPONSE_BLINKY_HEAL_TRAIN:
					return this.getBlinkyCreepBody(room, option.responseType === RESPONSE_MINI_BLINKY ? 6 : null);

				case RESPONSE_RANGED_HEAL_TRAIN:
				case RESPONSE_RANGED_BLINKY_TRAIN:
					return this.getRangedCreepBody(room);

				case RESPONSE_ATTACKER:
				case RESPONSE_ATTACK_HEAL_TRAIN:
				case RESPONSE_ATTACK_BLINKY_TRAIN:
					return this.getAttackCreepBody(room);

				default:
					return this.getBrawlerCreepBody(room);
			}
		}
		else if (option.trainStarter) {
			switch (option.segmentType) {
				case SEGMENT_HEAL:
					return this.getHealCreepBody(room);

				default:
					return this.getBlinkyCreepBody(room);
			}
		}

		return this.getBrawlerCreepBody(room);
	}

	getBrawlerCreepBody(room: Room, maxAttackParts?: number): BodyPartConstant[] {
		return (new BodyBuilder())
			.setWeights({[ATTACK]: 2, [HEAL]: 1})
			.setPartLimit(ATTACK, maxAttackParts)
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
			.setMoveBufferRatio(0.4)
			.build();
	}

	getBlinkyCreepBody(room: Room, maxAttackParts?: number): BodyPartConstant[] {
		return (new BodyBuilder())
			.setWeights({[RANGED_ATTACK]: 7, [HEAL]: 3})
			.setPartLimit(RANGED_ATTACK, maxAttackParts)
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
			.setMoveBufferRatio(0.4)
			.build();
	}

	getAttackCreepBody(room: Room): BodyPartConstant[] {
		return (new BodyBuilder())
			.setWeights({[ATTACK]: 1})
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
			.setMoveBufferRatio(0.4)
			.build();
	}

	getRangedCreepBody(room: Room): BodyPartConstant[] {
		return (new BodyBuilder())
			.setWeights({[RANGED_ATTACK]: 1})
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
			.setMoveBufferRatio(0.4)
			.build();
	}

	getHealCreepBody(room: Room): BodyPartConstant[] {
		return (new BodyBuilder())
			.setWeights({[HEAL]: 1})
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
			.setMoveBufferRatio(0.4)
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
	getCreepMemory(room: Room, option: BrawlerSpawnOption): CreepMemory {
		const memory = {
			target: option.targetPos || encodePosition(room.controller.pos),
			pathTarget: option.pathTarget,
			operation: option.operation,
			disableNotifications: true,
			train: null,
		};

		switch (option.responseType) {
			case RESPONSE_ATTACK_HEAL_TRAIN:
			case RESPONSE_RANGED_HEAL_TRAIN:
			case RESPONSE_BLINKY_HEAL_TRAIN:
				memory.train = {
					starter: true,
					partsToSpawn: [SEGMENT_HEAL],
				};
				break;

			case RESPONSE_ATTACK_BLINKY_TRAIN:
			case RESPONSE_RANGED_BLINKY_TRAIN:
			case RESPONSE_BLINKY_BLINKY_TRAIN:
				memory.train = {
					starter: true,
					partsToSpawn: [SEGMENT_BLINKY],
				};
				break;

			default:
				// No other segments need spawning.
				break;
		}

		if (option.trainStarter) {
			memory.train = {
				id: option.trainStarter,
			};
		}

		return memory;
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
	onSpawn(room: Room, option: BrawlerSpawnOption, body: BodyPartConstant[], name: string) {
		if (option.trainStarter) {
			// Remove segment from train spawn queue.
			const creep = Game.getObjectById(option.trainStarter);
			creep.memory.train.partsToSpawn = creep.memory.train.partsToSpawn.slice(1);
		}

		if (!option.operation) return;

		const position = option.targetPos;
		if (!position) return;

		const operation = Game.operations[option.operation];
		if (operation) {
			// @todo This will probably not record costs of later parts of a train.
			operation.addResourceCost(this.calculateBodyCost(body), RESOURCE_ENERGY);
		}

		if (!room.memory.recentBrawler) room.memory.recentBrawler = {};
		room.memory.recentBrawler[position] = Game.time;

		hivemind.log('creeps', room.name).info('Spawning new brawler', name, 'to defend', position);
	}
}
