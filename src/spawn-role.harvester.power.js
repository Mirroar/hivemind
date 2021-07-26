'use strict';

/* global hivemind CREEP_LIFE_TIME CREEP_SPAWN_TIME MAX_CREEP_SIZE MOVE HEAL
ATTACK POWER_BANK_HIT_BACK ATTACK_POWER HEAL_POWER */

const SpawnRole = require('./spawn-role');

module.exports = class PowerHarvesterSpawnRole extends SpawnRole {
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

			// @todo Determine realistic time until we crack open the power bank.
			// Then we can stop spawning attackers and spawn haulers instead.
			const travelTime = 50 * info.spawnRooms[room.name].distance;
			const timeToKill = info.hits / info.dps;
			const effectiveLifetime = 1 - (travelTime / CREEP_LIFE_TIME);
			const expectedDps = info.dps / _.size(info.spawnRooms);
			const expectedHps = expectedDps * POWER_BANK_HIT_BACK;

			// We're assigned to spawn creeps for this power gathering operation!
			const powerHarvesters = _.filter(Game.creepsByRole['harvester.power'] || [], creep => {
				if (creep.memory.sourceRoom === room.name && creep.memory.targetRoom === roomName && !creep.memory.isHealer) {
					if ((creep.ticksToLive || CREEP_LIFE_TIME) >= (CREEP_SPAWN_TIME * MAX_CREEP_SIZE) + travelTime) {
						return true;
					}
				}

				return false;
			});
			const powerHealers = _.filter(Game.creepsByRole['harvester.power'] || [], creep => {
				if (creep.memory.sourceRoom === room.name && creep.memory.targetRoom === roomName && creep.memory.isHealer) {
					if ((creep.ticksToLive || CREEP_LIFE_TIME) >= (CREEP_SPAWN_TIME * MAX_CREEP_SIZE) + travelTime) {
						return true;
					}
				}

				return false;
			});

			// Spawn attackers before healers.
			const currentDps = _.reduce(powerHarvesters, (total, creep) => total + (creep.memory.body[ATTACK] * ATTACK_POWER * effectiveLifetime), 0);
			const currentHps = _.reduce(powerHealers, (total, creep) => total + (creep.memory.body[HEAL] * HEAL_POWER * effectiveLifetime), 0);

			const dpsRatio = currentDps / expectedDps;
			const hpsRatio = expectedHps ? currentHps / expectedHps : 1;

			if (currentDps < expectedDps && dpsRatio <= hpsRatio && timeToKill > 0) {
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
