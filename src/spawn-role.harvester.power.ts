/* global RoomPosition CREEP_LIFE_TIME CREEP_SPAWN_TIME MAX_CREEP_SIZE
ATTACK POWER_BANK_HIT_BACK ATTACK_POWER HEAL_POWER MOVE HEAL */

import hivemind from 'hivemind';
import cache from 'cache';
import NavMesh from 'nav-mesh';
import {unpackCoordAsPos} from 'packrat';
import SpawnRole from 'spawn-role';

export default class PowerHarvesterSpawnRole extends SpawnRole {
	/**
	 * Adds gift spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		if (!hivemind.settings.get('enablePowerMining')) return;
		if (!Memory.strategy || !Memory.strategy.power || !Memory.strategy.power.rooms) return;

		_.each(Memory.strategy.power.rooms, (info, roomName) => {
			if (!info.isActive) return;
			if (!info.spawnRooms[room.name]) return;

			// We're assigned to spawn creeps for this power gathering operation!
			const activePowerHarvesters = _.filter(Game.creepsByRole['harvester.power'] || [], creep => {
				if (creep.memory.isHealer) return false;
				if (creep.memory.sourceRoom !== room.name) return false;
				if (creep.memory.targetRoom !== roomName) return false;

				const travelTime = this.getTravelTime(creep.memory.sourceRoom, creep.memory.targetRoom) || info.spawnRooms[room.name].distance * 50;
				if ((creep.ticksToLive || CREEP_LIFE_TIME) < (CREEP_SPAWN_TIME * MAX_CREEP_SIZE) + travelTime) return false;

				return true;
			});
			const activePowerHealers = _.filter(Game.creepsByRole['harvester.power'] || [], creep => {
				if (!creep.memory.isHealer) return false;
				if (creep.memory.sourceRoom !== room.name) return false;
				if (creep.memory.targetRoom !== roomName) return false;

				const travelTime = this.getTravelTime(creep.memory.sourceRoom, creep.memory.targetRoom) || info.spawnRooms[room.name].distance * 50;
				if ((creep.ticksToLive || CREEP_LIFE_TIME) < (CREEP_SPAWN_TIME * MAX_CREEP_SIZE) + travelTime) return false;

				return true;
			});

			// Spawn attackers before healers.
			const currentDps = _.reduce(
				activePowerHarvesters,
				(total, creep) => {
					return total + (creep.memory.body[ATTACK] * ATTACK_POWER);
				}, 0);
			const currentHps = _.reduce(
				activePowerHealers,
				(total, creep) => {
					return total + (creep.memory.body[HEAL] * HEAL_POWER);
				}, 0);

			// @todo Determine realistic time until we crack open the power bank.
			// Then we can stop spawning attackers and spawn haulers instead.
			const timeToKill = info.hits / info.dps;
			const expectedDps = info.dps;
			const expectedHps = expectedDps * POWER_BANK_HIT_BACK;
			const dpsRatio = currentDps / expectedDps;
			const hpsRatio = expectedHps ? currentHps / expectedHps : 1;

			if (currentDps < expectedDps && dpsRatio <= hpsRatio && timeToKill > 0 && activePowerHarvesters.length < info.freeTiles) {
				options.push({
					priority: hivemind.settings.get('powerMineCreepPriority'),
					weight: 1,
					targetRoom: roomName,
				});
			}

			// Also spawn healers.
			if (currentHps < expectedHps && dpsRatio > hpsRatio && timeToKill > 0) {
				options.push({
					priority: hivemind.settings.get('powerMineCreepPriority'),
					weight: 1,
					targetRoom: roomName,
					isHealer: true,
				});
			}
		});
	}

	getTravelTime(sourceRoom: string, targetRoom: string) {
		if (!hivemind.segmentMemory.isReady()) return;

		return cache.inHeap('powerTravelTime:' + sourceRoom + ':' + targetRoom, 1000, () => {
			const mesh = new NavMesh();
			if (!Game.rooms[sourceRoom]) return null;
			if (!Game.rooms[sourceRoom].isMine()) return null;

			const info = Memory.strategy.power.rooms[targetRoom];
			if (!info) return null;

			const sourcePos = Game.rooms[sourceRoom].roomPlanner.getRoomCenter();
			const targetPos = info.pos ? unpackCoordAsPos(info.pos, targetRoom) : new RoomPosition(25, 25, targetRoom);
			const result = mesh.findPath(sourcePos, targetPos);
			if (result.incomplete) return null;

			return result.path.length;
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
		const functionalPart = option.isHealer ? HEAL : ATTACK;
		const body = this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [functionalPart]: 0.5},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)
		);

		// Move parts should come first to soak up damage.
		_.sortBy(body, partType => {
			if (partType === MOVE) return 0;

			return 1;
		});

		return body;
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
			sourceRoom: room.name,
			targetRoom: option.targetRoom,
			isHealer: option.isHealer,
		};
	}
};
