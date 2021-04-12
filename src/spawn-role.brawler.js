'use strict';

/* global hivemind RoomPosition MOVE ATTACK HEAL */

const utilities = require('./utilities');
const SpawnRole = require('./spawn-role');
const stats = require('./stats');

module.exports = class BrawlerSpawnRole extends SpawnRole {
	/**
	 * Adds brawler spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		this.getLowLevelRoomSpawnOptions(room, options);
		this.getRemoteDefenseSpawnOptions(room, options);
	}

	/**
	 * Adds brawler spawn options for low level rooms.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getLowLevelRoomSpawnOptions(room, options) {
		// In low level rooms, add defenses!
		if (room.controller.level >= 4) return;
		if (!room.memory.enemies || room.memory.enemies.safe) return;
		if (_.size(room.creepsByRole.brawler) >= 2) return;

		options.push({
			priority: 5,
			weight: 1,
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
	getRemoteDefenseSpawnOptions(room, options) {
		const harvestPositions = room.getRemoteHarvestSourcePositions();
		for (const pos of harvestPositions) {
			const roomMemory = Memory.rooms[pos.roomName];
			if (!roomMemory || !roomMemory.enemies || roomMemory.enemies.safe) continue;

			const storagePos = utilities.encodePosition(room.storage ? room.storage.pos : room.controller.pos);
			const targetPos = utilities.encodePosition(new RoomPosition(25, 25, pos.roomName));

			// Don't spawn simple source defenders in quick succession.
			// If they fail, there's a stronger enemy that we need to deal with
			// in a different way.
			if (room.memory.recentBrawler && Game.time - (room.memory.recentBrawler[targetPos] || 0) < 1000) continue;

			const brawlers = _.filter(Game.creepsByRole.brawler || [], creep => creep.memory.storage === storagePos && creep.memory.target === targetPos);
			if (_.size(brawlers) > 0) continue;

			const creepSize = this.getDefenseCreepSize(room, roomMemory.enemies);

			hivemind.log('creeps', room.name).debug('Enemies:', roomMemory.enemies.damage, roomMemory.enemies.heal);
			hivemind.log('creeps', room.name).debug('Response:', creepSize);
			if (creepSize === 0) continue;

			options.push({
				priority: 3,
				weight: 1,
				targetPos,
				maxAttack: creepSize === 1 ? 4 : null,
				pathTarget: utilities.encodePosition(pos),
				creepSize,
			});
		}
	}

	getDefenseCreepSize(room, enemyData) {
		// Default defense creep has 4 attack and 3 heal parts.
		const defaultAttack = 4;
		const defaultHeal = 3;

		const enemyPower = enemyData.damage + enemyData.heal * 5;

		// For small attackers that should be defeated easily, use simple brawler.
		if (enemyPower < defaultAttack * ATTACK_POWER + defaultHeal * HEAL_POWER * 5) {
			return 1;
		}

		// If damage and heal suffices, use single range / heal creep.
		const blinkyBody = this.getBlinkyCreepBody(room);
		const numBlinkyRanged = _.filter(blinkyBody, p => p === RANGED_ATTACK).length;
		const numBlinkyHeal = _.filter(blinkyBody, p => p === HEAL).length;
		// hivemind.log('creeps', room.name).debug('Blinky:', numBlinkyRanged * RANGED_ATTACK_POWER, numBlinkyHeal * HEAL_POWER, blinkyBody.length);
		if (enemyPower < numBlinkyRanged * RANGED_ATTACK_POWER + numBlinkyHeal * HEAL_POWER * 5) {
			return 2;
		}

		// If needed, use 2-creep train.
		const rangedBody = this.getRangedBody(room);
		const healBody = this.getHealBody(room);
		const numTrainRanged = _.filter(rangedBody, p => p === RANGED_ATTACK).length;
		const numTrainHeal = _.filter(healBody, p => p === HEAL).length;
		// hivemind.log('creeps', room.name).debug('Train:', numTrainRanged * RANGED_ATTACK_POWER, numTrainHeal * HEAL_POWER, rangedBody.length, healBody.length);
		if (enemyPower < numTrainRanged * RANGED_ATTACK_POWER + numTrainHeal * HEAL_POWER * 5) {
			return 3;
		}

		// For more damage, can use ranged + blinky train.
		if (enemyPower < (numTrainRanged + numBlinkyRanged) * RANGED_ATTACK_POWER + numBlinkyHeal * HEAL_POWER * 5) {
			return 4;
		}

		// If attacker too strong, don't spawn defense at all.
		return 0;
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
			{[MOVE]: 0.5, [ATTACK]: 0.3, [HEAL]: 0.2},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
			option.maxAttack && {[ATTACK]: option.maxAttack}
		);
	}

	getBlinkyCreepBody(room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [RANGED_ATTACK]: 0.3, [HEAL]: 0.2},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)
		);
	}

	getRangedBody(room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [RANGED_ATTACK]: 0.5},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)
		);
	}

	getHealBody(room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [HEAL]: 0.5},
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
		return {
			storage: utilities.encodePosition(room.storage ? room.storage.pos : room.controller.pos),
			target: option.targetPos || utilities.encodePosition(room.controller.pos),
			pathTarget: option.pathTarget,
		};
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
		const position = option.targetPos;
		if (!position) return;

		if (!room.memory.recentBrawler) room.memory.recentBrawler = {};
		room.memory.recentBrawler[position] = Game.time;

		hivemind.log('creeps', room.name).info('Spawning new brawler', name, 'to defend', position);
		stats.addRemoteHarvestDefenseCost(room.name, position, this.calculateBodyCost(body));
	}
};
