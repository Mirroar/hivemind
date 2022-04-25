/* global RoomPosition CREEP_LIFE_TIME CREEP_SPAWN_TIME MAX_CREEP_SIZE
ATTACK POWER_BANK_HIT_BACK ATTACK_POWER HEAL_POWER MOVE HEAL */

import cache from 'utils/cache';
import hivemind from 'hivemind';
import NavMesh from 'utils/nav-mesh';
import SpawnRole from 'spawn-role/spawn-role';
import {getRoomIntel} from 'room-intel';
import {unpackCoordAsPos} from 'utils/packrat';
import {encodePosition, decodePosition} from 'utils/serialization';

export default class DepositHarvesterSpawnRole extends SpawnRole {
	/**
	 * Adds gift spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		if (!hivemind.settings.get('enableDepositMining')) return;
		if (room.getStoredEnergy() < hivemind.settings.get('minEnergyForDepositMining')) return;
		if (!Memory.strategy || !Memory.strategy.deposits || !Memory.strategy.deposits.rooms) return;

		_.each(Memory.strategy.deposits.rooms, (info, roomName) => {
			if (!info.isActive) return;

			const spawnRoomInfo = _.find(info.spawnRooms, spawnRoom => spawnRoom.room === room.name);
			if (!spawnRoomInfo) return;

			const roomIntel = getRoomIntel(roomName);
			const deposits = roomIntel.getDepositInfo();
			if (!deposits || deposits.length === 0) return;

			// We're assigned to spawn creeps for this deposit mining operation!
			for (const depositInfo of deposits) {
				const targetPos = encodePosition(new RoomPosition(depositInfo.x, depositInfo.y, roomName));
				const activeDepositHarvesters = _.filter(Game.creepsByRole['harvester.deposit'] || [], (creep: DepositHarvesterCreep) => {
					if (creep.memory.targetPos !== targetPos) return false;

					const travelTime = this.getTravelTime(creep.memory.origin, creep.memory.targetPos) || spawnRoomInfo.distance * 50;
					// if ((creep.ticksToLive || CREEP_LIFE_TIME) < (CREEP_SPAWN_TIME * creep.body.length) + travelTime) return false;

					return true;
				});

				if (activeDepositHarvesters.length < (depositInfo.freeTiles || 1)) {
					options.push({
						priority: 3,
						weight: 0,
						targetPos,
						origin: _.min(info.spawnRooms, r => r.distance).room,
					});
				}
			}
		});
	}

	getTravelTime(sourceRoom: string, targetPos: string) {
		if (!hivemind.segmentMemory.isReady()) return null;

		return cache.inHeap('depositTravelTime:' + sourceRoom + ':' + targetPos, 1000, () => {
			const mesh = new NavMesh();
			if (!Game.rooms[sourceRoom]) return null;
			if (!Game.rooms[sourceRoom].isMine()) return null;

			const sourcePos = Game.rooms[sourceRoom].roomPlanner.getRoomCenter();
			const targetPosition = decodePosition(targetPos);
			const result = mesh.findPath(sourcePos, targetPosition);
			if (result.incomplete) return null;

			// @todo Pathfind between waypoints to get actual travel time.

			return result.path.length * 25;
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
	getCreepBody(room, option) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [WORK]: 0.2, [CARRY]: 0.3},
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
	getCreepMemory(room, option) {
		return {
			origin: option.origin,
			targetPos: option.targetPos,
			// disableNotifications: true,
		};
	}
}
