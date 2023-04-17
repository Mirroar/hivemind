/* global RoomPosition MOVE ATTACK HEAL RANGED_ATTACK ATTACK_POWER
RANGED_ATTACK_POWER HEAL_POWER RESOURCE_ENERGY */

import cache from 'utils/cache';
import hivemind from 'hivemind';
import NavMesh from 'utils/nav-mesh';
import SpawnRole from 'spawn-role/spawn-role';
import {encodePosition, decodePosition} from 'utils/serialization';

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
		const options: BrawlerSpawnOption[] = [];
		this.getRemoteDefenseSpawnOptions(room, options);
		this.getPowerHarvestDefenseSpawnOptions(room, options);
		this.getTrainPartSpawnOptions(room, options);
		this.getReclaimSpawnOptions(room, options);

		return options;
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
			if (!operation || !operation.isUnderAttack()) continue;
			if (operation.needsDismantler() || !operation.isProfitable()) continue;

			// Don't spawn simple source defenders in quick succession.
			// If they fail, there's a stronger enemy that we need to deal with
			// in a different way.
			const targetPos = encodePosition(new RoomPosition(25, 25, pos.roomName));
			if (room.memory.recentBrawler && Game.time - (room.memory.recentBrawler[targetPos] || -1000) < 1000) continue;

			const brawlers = _.filter(Game.creepsByRole.brawler || [], (creep: Creep) => creep.memory.operation === 'mine:' + pos.roomName);
			if (_.size(brawlers) > 0) continue;

			const totalEnemyData: EnemyData = {
				parts: {},
				damage: 0,
				heal: 0,
				lastSeen: Game.time,
				safe: false,
			};

			for (const roomName of operation.getRoomsOnPath()) {
				// @todo Now that we're spawning defense for every room on the path,
				// make sure brawlers actually move to threatened rooms.
				const roomMemory = Memory.rooms[roomName];
				if (!roomMemory || !roomMemory.enemies || roomMemory.enemies.safe) continue;

				totalEnemyData.damage += roomMemory.enemies.damage;
				totalEnemyData.heal += roomMemory.enemies.heal;
				for (const part in roomMemory.enemies.parts || {}) {
					totalEnemyData.parts[part] = (totalEnemyData.parts[part] || 0) + roomMemory.enemies.parts[part];
				}
			}

			const responseType = this.getDefenseCreepSize(room, totalEnemyData);

			if (responseType === RESPONSE_NONE) continue;

			options.push({
				priority: 3,
				weight: 1,
				targetPos,
				pathTarget: encodePosition(pos),
				responseType,
				operation: operation.name,
			});
		}
	}

	getPowerHarvestDefenseSpawnOptions(room: Room, options: BrawlerSpawnOption[]) {
		if (!hivemind.settings.get('enablePowerMining')) return;
		if (!Memory.strategy || !Memory.strategy.power || !Memory.strategy.power.rooms) return;

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
		const defaultAttack = 4;
		const defaultHeal = 3;

		const enemyPower = enemyData.damage + (enemyData.heal * 5);
		const isRangedEnemy = (enemyData.parts[RANGED_ATTACK] || 0) > 0;

		// Use a reasonable attacker for destroying invader cores.
		if (enemyPower === 0) {
			return RESPONSE_ATTACKER;
		}

		// For small attackers that should be defeated easily, use simple brawler.
		if (enemyPower < (defaultAttack * ATTACK_POWER) + (defaultHeal * HEAL_POWER * 5)) {
			if (isRangedEnemy) return RESPONSE_MINI_BLINKY;

			return RESPONSE_MINI_BRAWLER;
		}

		// If damage and heal suffices, use single melee / heal creep.
		const brawlerBody = this.getBrawlerCreepBody(room);
		const numBrawlerAttack = _.filter(brawlerBody, p => p === ATTACK).length;
		const numBrawlerHeal = _.filter(brawlerBody, p => p === HEAL).length;
		if (!isRangedEnemy && enemyPower < (numBrawlerAttack * ATTACK_POWER) + (numBrawlerHeal * HEAL_POWER * 5)) {
			return RESPONSE_FULL_BRAWLER;
		}

		// If damage and heal suffices, use single range / heal creep.
		const blinkyBody = this.getBlinkyCreepBody(room);
		const numBlinkyRanged = _.filter(blinkyBody, p => p === RANGED_ATTACK).length;
		const numBlinkyHeal = _.filter(blinkyBody, p => p === HEAL).length;
		if (enemyPower < (numBlinkyRanged * RANGED_ATTACK_POWER) + (numBlinkyHeal * HEAL_POWER * 5)) {
			return RESPONSE_BLINKY;
		}

		// If needed, use 2-creep train.
		const attackBody = this.getAttackCreepBody(room);
		const rangedBody = this.getRangedCreepBody(room);
		const healBody = this.getHealCreepBody(room);
		const numTrainAttack = _.filter(attackBody, p => p === ATTACK).length;
		const numTrainRanged = _.filter(rangedBody, p => p === RANGED_ATTACK).length;
		const numTrainHeal = _.filter(healBody, p => p === HEAL).length;

		if (!isRangedEnemy && enemyPower < (numTrainAttack * ATTACK_POWER) + (numTrainHeal * HEAL_POWER * 5)) {
			return RESPONSE_ATTACK_HEAL_TRAIN;
		}

		if (!isRangedEnemy && enemyPower < (numTrainAttack * ATTACK_POWER) + (numBlinkyRanged * RANGED_ATTACK_POWER) + (numBlinkyHeal * HEAL_POWER * 5)) {
			return RESPONSE_ATTACK_BLINKY_TRAIN;
		}

		if (enemyPower < ((numTrainRanged + numBlinkyRanged) * RANGED_ATTACK_POWER) + (numBlinkyHeal * HEAL_POWER * 5)) {
			return RESPONSE_RANGED_BLINKY_TRAIN;
		}

		if (enemyPower < (2 * numBlinkyRanged * RANGED_ATTACK_POWER) + (2 * numBlinkyHeal * HEAL_POWER * 5)) {
			return RESPONSE_BLINKY_BLINKY_TRAIN;
		}

		if (enemyPower < (numTrainRanged * RANGED_ATTACK_POWER) + (numTrainHeal * HEAL_POWER * 5)) {
			return RESPONSE_RANGED_HEAL_TRAIN;
		}

		if (enemyPower < (numBlinkyRanged * RANGED_ATTACK_POWER) + ((numTrainHeal + numBlinkyHeal) * HEAL_POWER * 5)) {
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
				weight: 1,
				trainStarter: creep.id,
				segmentType,
			});
		}
	}

	getReclaimSpawnOptions(room: Room, options: BrawlerSpawnOption[]) {
		for (const targetRoom of Game.myRooms) {
			if (room.name === targetRoom.name) continue;
			if (!this.canReclaimRoom(targetRoom, room)) continue;

			options.push({
				priority: 4,
				weight: 1,
				targetPos: encodePosition(targetRoom.roomPlanner.getRoomCenter()),
				responseType: RESPONSE_BLINKY,
			});
		}
	}

	canReclaimRoom(targetRoom: Room, room: Room): boolean {
		if (!targetRoom.memory.isReclaimableSince) return false;
		if (!targetRoom.roomPlanner) return false;

		if (Game.time - targetRoom.memory.isReclaimableSince < 2000 && (targetRoom.controller.safeMode ?? 0) < 2_000) return false;

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
					return this.getBrawlerCreepBody(room, option.responseType === RESPONSE_MINI_BRAWLER ? 4 : null);

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
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [ATTACK]: 0.3, [HEAL]: 0.2},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
			maxAttackParts && {[ATTACK]: maxAttackParts},
		);
	}

	getBlinkyCreepBody(room: Room, maxAttackParts?: number): BodyPartConstant[] {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [RANGED_ATTACK]: 0.35, [HEAL]: 0.15},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
			maxAttackParts && {[RANGED_ATTACK]: maxAttackParts},
		);
	}

	getAttackCreepBody(room: Room, maxAttackParts?: number): BodyPartConstant[] {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [ATTACK]: 0.5},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
			maxAttackParts && {[ATTACK]: maxAttackParts},
		);
	}

	getRangedCreepBody(room: Room): BodyPartConstant[] {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [RANGED_ATTACK]: 0.5},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
		);
	}

	getHealCreepBody(room: Room): BodyPartConstant[] {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [HEAL]: 0.5},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
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
