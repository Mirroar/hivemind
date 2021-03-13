'use strict';

/* global MOVE WORK CARRY SOURCE_ENERGY_CAPACITY ENERGY_REGEN_TIME
CARRY_CAPACITY */

const utilities = require('./utilities');
const SpawnRole = require('./spawn-role');
const stats = require('./stats');

module.exports = class HaulerSpawnRole extends SpawnRole {
	/**
	 * Adds remote harvester spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		if (!room.memory.remoteHarvesting) return;

		const storagePos = utilities.encodePosition(room.storage ? room.storage.pos : room.controller.pos);
		const harvestPositions = room.getRemoteHarvestSourcePositions();
		for (const pos of harvestPositions) {
			utilities.precalculatePaths(room, pos);
			const targetPos = utilities.encodePosition(pos);
			if (!room.memory.remoteHarvesting[targetPos]) continue;

			const harvestMemory = room.memory.remoteHarvesting[targetPos];
			const cachedPathLength = harvestMemory.cachedPath && harvestMemory.cachedPath.path && harvestMemory.cachedPath.path.length;
			const travelTime = cachedPathLength || harvestMemory.travelTime;
			const travelTimeSpawn = harvestMemory.travelTime || cachedPathLength;

			const haulers = _.filter(
				Game.creepsByRole.hauler || {},
				creep => {
					// @todo Instead of filtering for every room, this could be grouped once per tick.
					if (creep.memory.storage !== storagePos || creep.memory.source !== targetPos) return false;

					if (creep.spawning) return true;
					if (!travelTimeSpawn) return true;
					if (creep.ticksToLive > travelTimeSpawn || creep.ticksToLive > 500) return true;

					return false;
				}
			);

			// Determine how many haulers to spawn for this route.d
			let maxHaulers = 0;
			let requiredCarryParts;
			if (harvestMemory.revenue > 0 || harvestMemory.hasContainer) {
				maxHaulers = 1;

				if (Game.rooms[pos.roomName] && Game.rooms[pos.roomName].isMine(true)) {
					maxHaulers = 2;
				}
			}

			if (travelTime) {
				requiredCarryParts = Math.ceil(travelTime * SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME / CARRY_CAPACITY);

				// If we cannot create big enough haulers (yet), create more of them!
				const maximumBody = this.generateCreepBodyFromWeights(
					this.getBodyWeights(),
					room.energyCapacityAvailable,
					{[CARRY]: requiredCarryParts}
				);
				const carryPartsPerHauler = _.countBy(maximumBody)[CARRY];

				const multiplier = Math.min(requiredCarryParts / carryPartsPerHauler, 3);
				maxHaulers *= multiplier;
			}

			if (_.size(haulers) >= maxHaulers) continue;

			options.push({
				priority: 3,
				weight: 0.8,
				targetPos,
				// Use less work parts if room is not reserved yet.
				size: requiredCarryParts,
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
			room.controller.level > 3 ? this.getBodyWeights() : this.getNoRoadsBodyWeight(),
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
			{[CARRY]: option.size}
		);
	}

	/**
	 * Determine body weights for haulers.
	 *
	 * @return {object}
	 *   An object containing body part weights, keyed by type.
	 */
	getBodyWeights() {
		return {[MOVE]: 0.35, [WORK]: 0.05, [CARRY]: 0.6};
	}

	/**
	 * Determine body weights for haulers when no roads are being built.
	 *
	 * @return {object}
	 *   An object containing body part weights, keyed by type.
	 */
	getNoRoadsBodyWeight() {
		return {[MOVE]: 0.5, [CARRY]: 0.5};
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
			source: option.targetPos,
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
	onSpawn(room, option, body) {
		const position = option.targetPos;
		if (!position) return;

		stats.addRemoteHarvestCost(room.name, position, this.calculateBodyCost(body));
	}
};
