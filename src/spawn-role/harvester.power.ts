/* global RoomPosition CREEP_LIFE_TIME CREEP_SPAWN_TIME MAX_CREEP_SIZE
ATTACK POWER_BANK_HIT_BACK ATTACK_POWER HEAL_POWER MOVE HEAL */

import BodyBuilder from 'creep/body-builder';
import hivemind from 'hivemind';
import NavMesh from 'utils/nav-mesh';
import SpawnRole from 'spawn-role/spawn-role';

interface PowerHarvesterSpawnOption extends SpawnOption {
	targetRoom: string;
	isHealer: boolean;
}

export default class PowerHarvesterSpawnRole extends SpawnRole {
	/**
	 * Adds power harvester spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): PowerHarvesterSpawnOption[] {
		if (!hivemind.settings.get('enablePowerMining')) return [];

		return this.cacheEmptySpawnOptionsFor(room, 100, () => {
			if (!Memory.strategy || !Memory.strategy.power || !Memory.strategy.power.rooms) return [];

			const options: PowerHarvesterSpawnOption[] = [];
			_.each(Memory.strategy.power.rooms, (info, roomName) => {
				if (!info.isActive) return;
				if (!info.spawnRooms[room.name]) return;

				this.addOptionsForTarget(info, roomName, room, options);
			});

			return options;
		});
	}

	addOptionsForTarget(info: PowerTargetRoom, roomName: string, sourceRoom: Room, options: PowerHarvesterSpawnOption[]) {
		// We're assigned to spawn creeps for this power gathering operation!
		const activePowerHarvesters = _.filter(Game.creepsByRole['harvester.power'] || [], (creep: Creep) => {
			if (creep.memory.isHealer) return false;
			if (creep.memory.sourceRoom !== sourceRoom.name) return false;
			if (creep.memory.targetRoom !== roomName) return false;

			const travelTime = this.getTravelTime(creep.memory.sourceRoom, creep.memory.targetRoom) || info.spawnRooms[sourceRoom.name].distance * 50;
			if ((creep.ticksToLive || CREEP_LIFE_TIME) < (CREEP_SPAWN_TIME * MAX_CREEP_SIZE) + travelTime) return false;

			return true;
		});
		const activePowerHealers = _.filter(Game.creepsByRole['harvester.power'] || [], (creep: Creep) => {
			if (!creep.memory.isHealer) return false;
			if (creep.memory.sourceRoom !== sourceRoom.name) return false;
			if (creep.memory.targetRoom !== roomName) return false;

			const travelTime = this.getTravelTime(creep.memory.sourceRoom, creep.memory.targetRoom) || info.spawnRooms[sourceRoom.name].distance * 50;
			if ((creep.ticksToLive || CREEP_LIFE_TIME) < (CREEP_SPAWN_TIME * MAX_CREEP_SIZE) + travelTime) return false;

			return true;
		});

		// Spawn attackers before healers.
		const currentDps = _.reduce(
			activePowerHarvesters,
			(total, creep) => total + (creep.getActiveBodyparts(ATTACK) * ATTACK_POWER), 0);
		const currentHps = _.reduce(
			activePowerHealers,
			(total, creep) => total + (creep.getActiveBodyparts(HEAL) * HEAL_POWER), 0);

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
				isHealer: false,
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
	}

	getTravelTime(sourceRoom: string, targetRoom: string): number {
		const info = Memory.strategy.power.rooms[targetRoom];
		if (!info) return null;
		if (!hivemind.segmentMemory.isReady()) return null;
		if (!Game.rooms[sourceRoom]) return null;
		if (!Game.rooms[sourceRoom].isMine()) return null;

		const sourcePos = Game.rooms[sourceRoom].roomPlanner.getRoomCenter();
		const targetPos = new RoomPosition(25, 25, targetRoom);

		const mesh = new NavMesh();
		return mesh.estimateTravelTime(sourcePos, targetPos);
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
	getCreepBody(room: Room, option: PowerHarvesterSpawnOption): BodyPartConstant[] {
		const functionalPart = option.isHealer ? HEAL : ATTACK;

		return (new BodyBuilder())
			.setWeights({[functionalPart]: 1})
			.setMoveBufferRatio(1)
			.setEnergyLimit(Math.max(room.energyCapacityAvailable * 0.9, Math.min(room.energyAvailable, room.energyCapacityAvailable)))
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
	getCreepMemory(room: Room, option: PowerHarvesterSpawnOption): CreepMemory {
		return {
			sourceRoom: room.name,
			targetRoom: option.targetRoom,
			isHealer: option.isHealer,
			disableNotifications: true,
		};
	}
}
