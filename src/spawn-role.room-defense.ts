'use strict';

/* global hivemind MOVE ATTACK WORK CARRY HEAL */

import SpawnRole from './spawn-role';

const RESPONSE_NONE = 0;
const RESPONSE_ATTACKER = 1;

export default class RoomDefenseSpawnRole extends SpawnRole {
	/**
	 * Adds brawler spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		this.addLowLevelRoomSpawnOptions(room, options);
		this.addRampartDefenderSpawnOptions(room, options);
		this.addEmergencyRepairSpawnOptions(room, options);
	}

	/**
	 * Adds brawler spawn options for low level rooms.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	addLowLevelRoomSpawnOptions(room, options) {
		// In low level rooms, add defenses!
		if (room.controller.level >= 4) return;
		if (!room.memory.enemies || room.memory.enemies.safe) return;
		if (_.size(room.creepsByRole.brawler) >= 2) return;

		options.push({
			priority: 5,
			weight: 1,
			creepRole: 'brawler',
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
	addRampartDefenderSpawnOptions(room, options) {
		if (room.controller.level < 4) return;
		if (!room.memory.enemies || room.memory.enemies.safe) return;

		const responseType = this.getDefenseCreepSize(room, room.memory.enemies);

		if (responseType === RESPONSE_NONE) return;

		// @todo Limit defense creeps to number of threats.
		if (_.size(room.creepsByRole.guardian) >= 2) return;

		options.push({
			priority: 5,
			weight: 1,
			responseType,
			creepRole: 'guardian',
		});
	}

	/**
	 * Spawn extra builders to keep ramparts up when attacked.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	addEmergencyRepairSpawnOptions(room, options) {
		if (room.controller.level < 4) return;
		if (!room.memory.enemies || room.memory.enemies.safe) return;
		if (room.getStoredEnergy() < 10000) return;

		// @todo Send energy to rooms under attack for assistance.

		const responseType = this.getDefenseCreepSize(room, room.memory.enemies);

		if (responseType === RESPONSE_NONE) return;

		if (_.size(room.creepsByRole.builder) >= 5) return;

		options.push({
			priority: 4,
			weight: 1,
			responseType,
			creepRole: 'builder',
		});
	}

	getDefenseCreepSize(room) {
		const enemyStrength = room.defense.getEnemyStrength();

		if (enemyStrength >= 2) return RESPONSE_ATTACKER;

		// @todo Decide if boosts should be used as well.

		// If attacker too weak, don't spawn defense at all. Towers will handle it.
		return RESPONSE_NONE;
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
		if (option.responseType) {
			switch (option.responseType) {
				case RESPONSE_ATTACKER:
				default:
					return this.getAttackCreepBody(room);
			}
		}

		if (option.creepRole === 'builder') return this.getRepairCreepBody(room);

		return this.getBrawlerCreepBody(room);
	}

	getAttackCreepBody(room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.35, [ATTACK]: 0.65},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)
		);
	}

	getRepairCreepBody(room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.35, [WORK]: 0.35, [CARRY]: 0.3},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)
		);
	}

	getBrawlerCreepBody(room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [ATTACK]: 0.3, [HEAL]: 0.2},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)
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
		const memory = {
			singleRoom: room.name,
			role: option.creepRole,
		};

		return memory;
	}

	/**
	 * Gets which boosts to use on a new creep.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object} option
	 *   The spawn option for which to generate the body.
	 * @param {string[]} body
	 *   The body generated for this creep.
	 *
	 * @return {Object}
	 *   The boost compound to use keyed by body part type.
	 */
	getCreepBoosts(room, option, body) {
		// @todo Only use boosts if they'd make the difference between being able to damage the enemy or not.
		if (option.creepRole === 'builder') {
			return this.generateCreepBoosts(room, body, WORK, 'repair');
		}
		else if (option.creepRole === 'guardian') {
			return this.generateCreepBoosts(room, body, ATTACK, 'attack');
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
	onSpawn(room, option, body, name) {
		if (option.creepRole === 'guardian') {
			hivemind.log('creeps', room.name).info('Spawning new guardian', name, 'to defend', room.name);
			Game.notify('Spawning new guardian ' + name + ' to defend ' + room.name + ' at tick ' + Game.time);
		}
	}
};
