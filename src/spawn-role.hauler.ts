/* global MOVE WORK CARRY RESOURCE_ENERGY */

declare global {
	interface CreepMemory {
		source?: any,
	}
}

import utilities from './utilities';
import SpawnRole from './spawn-role';
import RemoteMiningOperation from './operation.remote-mining';

export default class HaulerSpawnRole extends SpawnRole {
	/**
	 * Adds remote harvester spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions(room, options) {
		const harvestPositions = room.getRemoteHarvestSourcePositions();
		for (const pos of harvestPositions) {
			const targetPos = utilities.encodePosition(pos);
			const operation = Game.operationsByType.mining['mine:' + pos.roomName];

			// Don't spawn if enemies are in the room.
			// @todo Or in any room on the route, actually.
			if (!operation || operation.isUnderAttack() || !operation.shouldSpawnHaulers(targetPos)) continue;

			// Don't spawn if there is no full path.
			const paths = operation.getPaths();
			const path = paths[targetPos];
			const travelTime = path && path.travelTime;
			if (!travelTime) continue;

			const requiredCarryParts = operation.getHaulerSize(targetPos);

			// Determine how many haulers to spawn for this route.
			// If we cannot create big enough haulers (yet), create more of them!
			const maximumBody = this.generateCreepBodyFromWeights(
				this.getBodyWeights(),
				room.energyCapacityAvailable,
				{[CARRY]: requiredCarryParts}
			);
			const carryPartsPerHauler = _.countBy(maximumBody)[CARRY];

			const multiplier = Math.ceil(Math.min(requiredCarryParts / carryPartsPerHauler, 3));
			const baseHaulers = operation.getHaulerCount();
			const maxHaulers = baseHaulers * multiplier;
			const adjustedCarryParts = Math.ceil(requiredCarryParts / multiplier);

			const haulers = _.filter(
				Game.creepsByRole.hauler || {},
				creep => {
					// @todo Instead of filtering for every room, this could be grouped once per tick.
					if (creep.memory.source !== targetPos) return false;

					if (creep.spawning) return true;
					if (creep.ticksToLive > travelTime || creep.ticksToLive > 500) return true;

					return false;
				}
			);

			if (_.size(haulers) >= maxHaulers) continue;

			options.push({
				priority: 3,
				weight: 0.8,
				targetPos,
				size: adjustedCarryParts,
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
			room.controller.level > 3 && room.storage ? this.getBodyWeights() : this.getNoRoadsBodyWeight(),
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
		// @todo Always spawn without work parts. Spawn a dedicated builder
		// when roads need to be built, or at least one road is at < 25% hits.
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
			// @todo Get rid of storage position
			storage: utilities.encodePosition(room.storage ? room.storage.pos : room.controller.pos),
			source: option.targetPos,
			operation: 'mine:' + utilities.decodePosition(option.targetPos).roomName,
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
		const operationName = 'mine:' + utilities.decodePosition(option.targetPos).roomName;
		const operation = Game.operations[operationName];
		if (!operation) return;

		operation.addResourceCost(this.calculateBodyCost(body), RESOURCE_ENERGY);
	}
};
