'use strict';

/* global MOVE ATTACK RANGED_ATTACK HEAL TOUGH CLAIM CARRY WORK */

const SpawnRole = require('./spawn-role');

module.exports = class SquadSpawnRole extends SpawnRole {
	/**
	 * Adds squad spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		_.each(Game.squads, squad => {
			if (squad.getSpawn() !== room.name) return;
			const spawnUnitType = this.needsSpawning(squad);
			if (!spawnUnitType) return;

			const roomHasReserves = room.getStoredEnergy() > 10000;
			options.push({
				priority: roomHasReserves ? 4 : 2,
				weight: 1.1,
				unitType: spawnUnitType,
				squad: squad.name,
			});
		});
	}

	/**
	 * Decides whether a squad needs additional units spawned.
	 *
	 * @param {Squad} squad
	 *   The squad to check.
	 *
	 * @return {string|null}
	 *   Type of the unit that needs spawning.
	 */
	needsSpawning(squad) {
		const neededUnits = [];
		for (const unitType in squad.memory.composition) {
			if (squad.memory.composition[unitType] > _.size(squad.units[unitType])) {
				neededUnits.push(unitType);
			}
		}

		if (_.size(neededUnits) === 0) squad.memory.fullySpawned = true;

		// @todo Some squad units might need to be spawned at higher priorities
		// than others.
		return _.sample(neededUnits);
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
		// Automatically call spawning function for selected unit type.
		const methodName = 'get' + _.capitalize(option.unitType) + 'CreepBody';
		if (this[methodName]) return this[methodName](room, option);

		// If the unit type is not supported, spawn a general brawler.
		return this.getBrawlerCreepBody(room, option);
	}

	getRangerCreepBody(room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [RANGED_ATTACK]: 0.3, [HEAL]: 0.2},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)
		);
	}

	getHealerCreepBody(room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.52, [HEAL]: 0.48},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)
		);
	}

	getClaimerCreepBody(room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.52, [TOUGH]: 0.18, [CLAIM]: 0.3},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)
		);
	}

	getSingleClaimCreepBody() {
		return [MOVE, MOVE, MOVE, MOVE, MOVE, CLAIM];
	}

	getBuilderCreepBody(room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.52, [CARRY]: 0.28, [WORK]: 0.2},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)
		);
	}

	getAttackerCreepBody(room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [ATTACK]: 0.5},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)
		);
	}

	getTestCreepBody() {
		return [MOVE];
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
		return {
			role: 'brawler',
			squadName: option.squad,
			squadUnitType: option.unitType,
		};
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
		if (option.unitType === 'healer') {
			return this.generateCreepBoosts(room, body, HEAL, 'heal');
		}

		if (option.unitType === 'attacker') {
			return this.generateCreepBoosts(room, body, ATTACK, 'attack');
		}
	}
};
