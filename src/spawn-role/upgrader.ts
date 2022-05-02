/* global FIND_MY_CONSTRUCTION_SITES CONTROLLER_DOWNGRADE
MOVE WORK CARRY CONTROLLER_MAX_UPGRADE_PER_TICK */

import hivemind from 'hivemind';
import SpawnRole from 'spawn-role/spawn-role';

export default class UpgraderSpawnRole extends SpawnRole {
	/**
	 * Adds upgrader spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room) {
		const options: SpawnOption[] = [];
		const maxUpgraders = this.getUpgraderAmount(room);
		const numUpgraders = _.size(_.filter(room.creepsByRole.upgrader, creep => !creep.ticksToLive || creep.ticksToLive > creep.body.length * 3));
		if (numUpgraders < maxUpgraders) {
			options.push({
				priority: 3,
				weight: 1,
			});
		}

		return options;
	}

	/**
	 * Gets number of needed upgraders depending on room needs.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 *
	 * @return {number}
	 *   The requested number of upgraders.
	 */
	getUpgraderAmount(room: Room): number {
		const maxUpgraders = this.getBaseUpgraderAmount(room);

		if (maxUpgraders === 0) {
			if (room.controller.level === 1) {
				// Level 1 rooms should be upgraded ASAP, should usually only happen
				// in the first claimed room, since otherwise remote builders will
				// have upgraded the room already.
				return 1;
			}

			// Even if no upgraders are needed, at least create one when the controller is getting close to being downgraded.
			if (room.controller.ticksToDowngrade < CONTROLLER_DOWNGRADE[room.controller.level] * 0.1) {
				hivemind.log('creeps', room.name).info('trying to spawn upgrader because controller is close to downgrading', room.controller.ticksToDowngrade, '/', CONTROLLER_DOWNGRADE[room.controller.level]);
				return 1;
			}
			else if (room.controller.ticksToDowngrade < CONTROLLER_DOWNGRADE[room.controller.level] * 0.5 && room.getStoredEnergy() > 5000) {
				return 1;
			}
		}

		return maxUpgraders;
	}

	/**
	 * Gets number of needed upgraders depending on room needs.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 *
	 * @return {number}
	 *   The requested number of upgraders.
	 */
	getBaseUpgraderAmount(room: Room): number {
		// Do not spawn upgraders in evacuating rooms.
		if (room.isEvacuating()) return 0;

		const availableEnergy = room.getStoredEnergy();
		if (!room.storage && !room.terminal && room.find(FIND_MY_CONSTRUCTION_SITES).length > 0 && availableEnergy < 2000) {
			// Do not spawn upgraders when builders and spawns will need most of
			// our energy.
			return 0;
		}

		// RCL 8 rooms can't make use of more than 1 upgrader.
		if (room.controller.level === 8) {
			if (availableEnergy < hivemind.settings.get('minEnergyToUpgradeAtRCL8')) return 0;
			return 1;
		}

		// Small rooms that don't have a storage yet shouls spawn upgraders depending on available energy.
		if (room.controller.level <= 4 && !room.storage) {
			const numSources = _.size(room.sources);
			const maxUpgraders = 1 + numSources + Math.floor(availableEnergy / 1000);
			return Math.min(maxUpgraders, 9);
		}

		// Spawn upgraders depending on stored energy.
		// RCL 7 rooms need to keep a bit more energy in reserve for doing other
		// things like power or deposit harvesting, sending squads, ...
		if (availableEnergy < (room.controller.level === 7 ? 25_000 : 10_000)) return 0;
		if (availableEnergy < (room.controller.level === 7 ? 75_000 : 50_000)) return 1;
		if (availableEnergy < 100_000) return 2;
		// @todo Have maximum depend on number of work parts.
		// @todo Make sure enough energy is brought by.
		return 3;
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
	getCreepBody(room: Room): BodyPartConstant[] {
		let bodyWeights = {[MOVE]: 0.35, [WORK]: 0.3, [CARRY]: 0.35};
		if (room.memory.controllerContainer || room.memory.controllerLink) {
			// If there is easy access to energy, we can save on move an carry parts.
			bodyWeights = {[MOVE]: 0.2, [WORK]: 0.75, [CARRY]: 0.05};
		}

		return this.generateCreepBodyFromWeights(
			bodyWeights,
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
			{[WORK]: CONTROLLER_MAX_UPGRADE_PER_TICK},
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
	getCreepMemory(room: Room): CreepMemory {
		return {
			singleRoom: room.name,
			operation: 'room:' + room.name,
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
	getCreepBoosts(room: Room, option: SpawnOption, body: BodyPartConstant[]) {
		if (room.getStoredEnergy() < 200_000) return {};
		if (room.controller.level < 8) return {};

		return this.generateCreepBoosts(room, body, WORK, 'upgradeController');
	}
}
