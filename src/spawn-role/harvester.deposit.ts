/* global RoomPosition CREEP_LIFE_TIME CREEP_SPAWN_TIME MAX_CREEP_SIZE
ATTACK POWER_BANK_HIT_BACK ATTACK_POWER HEAL_POWER MOVE HEAL */

import BodyBuilder from 'creep/body-builder';
import cache from 'utils/cache';
import hivemind from 'hivemind';
import NavMesh from 'utils/nav-mesh';
import SpawnRole from 'spawn-role/spawn-role';
import {getRoomIntel} from 'room-intel';
import {encodePosition, decodePosition} from 'utils/serialization';

interface DepositHarvesterSpawnOption extends SpawnOption {
	targetPos: string;
	origin: string;
}

export default class DepositHarvesterSpawnRole extends SpawnRole {
	/**
	 * Adds deposit harvester spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): DepositHarvesterSpawnOption[] {
		if (!hivemind.settings.get('enableDepositMining')) return [];
		if (room.getEffectiveAvailableEnergy() < hivemind.settings.get('minEnergyForDepositMining')) return [];
		if (!Memory.strategy || !Memory.strategy.deposits || !Memory.strategy.deposits.rooms) return [];

		const options: DepositHarvesterSpawnOption[] = [];
		_.each(Memory.strategy.deposits.rooms, (info, roomName) => {
			if (!info.isActive) return;

			const spawnRoomInfo = _.find(info.spawnRooms, spawnRoom => spawnRoom.room === room.name);
			if (!spawnRoomInfo) return;

			const roomIntel = getRoomIntel(roomName);
			const deposits = roomIntel.getDepositInfo();
			if (!deposits || deposits.length === 0) return;

			// We're assigned to spawn creeps for this deposit mining operation!
			for (const depositInfo of deposits) {
				this.addOptionForDeposit(depositInfo, info, roomName, spawnRoomInfo, options);
			}
		});

		return options;
	}

	addOptionForDeposit(depositInfo: DepositInfo, strategyInfo: DepositTargetRoom, depositRoomName: string, spawnRoomInfo: {room: string; distance: number}, options: DepositHarvesterSpawnOption[]) {
		const targetPos = encodePosition(new RoomPosition(depositInfo.x, depositInfo.y, depositRoomName));
		const activeDepositHarvesters = _.filter(Game.creepsByRole['harvester.deposit'] || [], (creep: DepositHarvesterCreep) => {
			if (creep.memory.targetPos !== targetPos) return false;

			const travelTime = this.getTravelTime(creep.memory.origin, creep.memory.targetPos) || spawnRoomInfo.distance * 50;
			// If ((creep.ticksToLive || CREEP_LIFE_TIME) < (CREEP_SPAWN_TIME * creep.body.length) + travelTime) return false;

			return true;
		});

		if (activeDepositHarvesters.length < (depositInfo.freeTiles || 1)) {
			options.push({
				priority: 3,
				weight: 0,
				targetPos,
				// We use the closest spawn room as supposed origin, because that will
				// make delivery faster.
				origin: _.min(strategyInfo.spawnRooms, r => r.distance).room,
			});
		}
	}

	getTravelTime(sourceRoom: string, targetPos: string): number {
		if (!hivemind.segmentMemory.isReady()) return null;
		if (!Game.rooms[sourceRoom]) return null;
		if (!Game.rooms[sourceRoom].isMine()) return null;

		const sourcePosition = Game.rooms[sourceRoom].roomPlanner.getRoomCenter();
		const targetPosition = decodePosition(targetPos);

		const mesh = new NavMesh();
		return mesh.estimateTravelTime(sourcePosition, targetPosition);
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
			.setWeights({[CARRY]: 3, [WORK]: 2})
			.setEnergyLimit(Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable))
			.build();	}

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
	getCreepMemory(room: Room, option: DepositHarvesterSpawnOption): DepositHarvesterCreepMemory {
		return {
			role: 'harvester.deposit',
			origin: option.origin,
			targetPos: option.targetPos,
			// DisableNotifications: true,
		};
	}
}
