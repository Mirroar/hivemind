'use strict';

/* global MOVE ATTACK HEAL */

const utilities = require('./utilities');
const SpawnRole = require('./spawn-role');

module.exports = class ExploitSpawnRole extends SpawnRole {
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

			const brawlers = _.filter(Game.creepsByRole.brawler || [], creep => creep.memory.storage === storagePos && creep.memory.target === targetPos);
			if (_.size(brawlers) > 0) continue;

			options.push({
				priority: 3,
				weight: 1,
				targetPos,
				maxAttack: 4,
				pathTarget: utilities.encodePosition(pos),
			});
		}
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
			option.maxAttack ? {[ATTACK]: option.maxAttack}
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
	 *
	 */
	onSpawn(room, option, body) {
		const position = utilities.encodePosition(harvestPosition);
		console.log('Spawning new brawler to defend', position, ':', result);

		const cost = this.calculateCreepBodyCost(Memory.creeps[result].body);
		stats.addRemoteHarvestDefenseCost(this.room.name, position, cost);
	}
};
