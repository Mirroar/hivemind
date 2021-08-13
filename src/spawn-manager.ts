'use strict';

/* global BODYPART_COST OK */

import utilities from './utilities';

const roleNameMap = {
	builder: 'B',
	'builder.exploit': 'BE',
	'builder.remote': 'BR',
	claimer: 'C',
	dismantler: 'D',
	brawler: 'F',
	gatherer: 'G',
	guardian: 'FE',
	gift: ':) GIFT (: ',
	harvester: 'H',
	'harvester.exploit': 'HE',
	'harvester.minerals': 'HM',
	'harvester.remote': 'HR',
	'harvester.power': 'HP',
	scout: 'S',
	transporter: 'T',
	'hauler.exploit': 'TE',
	'hauler.power': 'TP',
	hauler: 'TR',
	upgrader: 'U',
};

export default class SpawnManager {
	/**
	 * Creates a new SpawnManager instance.
	 */
	constructor() {
		this.roles = {};
	}

	/**
	 * Registers a role to be managed.
	 *
	 * @param {String} roleId
	 *   Identifier of the role, as stored in a creep's memory.
	 * @param {Role} role
	 *   The role to register.
	 */
	registerSpawnRole(roleId, role) {
		this.roles[roleId] = role;
	}

	/**
	 * Collects spawn options from all spawn roles.
	 *
	 * @param {Room} room
	 *   The room to use as context for spawn roles.
	 *
	 * @return {object[]}
	 *   An array of possible spawn options for the current room.
	 */
	getAllSpawnOptions(room) {
		const options = [];

		_.each(this.roles, (role, roleId) => {
			if (role.getSpawnOptions) {
				const roleOptions = [];
				role.getSpawnOptions(room, roleOptions);

				_.each(roleOptions, option => {
					// Set default values for options.
					if (typeof option.role === 'undefined') option.role = roleId;

					options.push(option);
				});
			}
		});

		return options;
	}

	/**
	 * Manages spawning in a room.
	 *
	 * @param {Room} room
	 *   The room to manage spawning in.
	 * @param {StructureSpawn[]} spawns
	 *   The room's spawns.
	 */
	manageSpawns(room, spawns) {
		const availableSpawns = this.filterAvailableSpawns(spawns);
		if (availableSpawns.length === 0) return;

		const options = this.getAllSpawnOptions(room);
		const option = utilities.getBestOption(options);
		if (!option) return;

		let spawn = _.sample(availableSpawns);
		if (option.preferClosestSpawn) {
			spawn = _.min(spawns, spawn => spawn.pos.getRangeTo(option.preferClosestSpawn));
			// Only spawn once preferred spawn is ready.
			if (availableSpawns.indexOf(spawn) === -1) return;
		}

		if (!this.trySpawnCreep(room, spawn, option)) {
			_.each(availableSpawns, s => {
				s.waiting = true;
			});
		}

		_.each(spawns, spawn => {
			spawn.numSpawnOptions = _.size(options);
		});
	}

	/**
	 * Tries spawning the selected creep.
	 *
	 * @param {Room} room
	 *   The room to manage spawning in.
	 * @param {StructureSpawn} spawn
	 *   The spawn where the creep should be spawned.
	 * @param {Object} option
	 *   The spawn option for which to generate the creep.
	 *
	 * @return {boolean}
	 *   True if spawning was successful.
	 */
	trySpawnCreep(room, spawn, option) {
		const role = this.roles[option.role];
		const body = role.getCreepBody(room, option);

		if (!body || body.length === 0) return false;

		let cost = 0;
		for (const part of body) {
			cost += BODYPART_COST[part];
		}

		if (cost > room.energyAvailable) return false;

		//  Make sure a creep like this could be spawned.
		if (spawn.spawnCreep(body, 'dryRun', {dryRun: true}) !== OK) return false;

		// Prepare creep memory.
		const memory = role.getCreepMemory(room, option);
		if (!memory.role) {
			memory.role = option.role;
		}

		// Store creep's body definition in memory for easier access.
		memory.body = _.countBy(body);

		// Actually try to spawn this creep.
		// @todo Use extensions grouped by bay to make refilling easier.
		const creepName = this.generateCreepName(memory.role);
		const result = spawn.spawnCreep(body, creepName, {
			memory,
		});

		if (result !== OK) return false;

		// Spawning successful.
		Memory.creepCounter[memory.role]++;

		// Also notify room's boost manager if necessary.
		const boosts = role.getCreepBoosts(room, option, body);
		if (boosts && room.boostManager) {
			room.boostManager.markForBoosting(creepName, boosts);
		}

		// Notify the role that spawning was successful.
		role.onSpawn(room, option, body, creepName);
		return true;
	}

	/**
	 * Generates a name for a new creep.
	 *
	 * @param {String} roleId
	 *   Identifier of the role, as stored in a creep's memory.
	 *
	 * @return {String}
	 *   The generated name.
	 */
	generateCreepName(roleId) {
		// Generate creep name.
		if (!Memory.creepCounter) {
			Memory.creepCounter = {};
		}

		if (!Memory.creepCounter[roleId] || Memory.creepCounter[roleId] >= 36 * 36) {
			Memory.creepCounter[roleId] = 0;
		}

		const roleName = roleNameMap[roleId] || roleId;
		return roleName + '_' + Memory.creepCounter[roleId].toString(36);
	}

	/**
	 * Filters a list of spawns to only those available for spawning.
	 *
	 * @param {StructureSpawn[]} spawns
	 *   The list of spawns to filter.
	 *
	 * @return {StructureSpawn[]}
	 *   An array containing all spawns where spawning is possible.
	 */
	filterAvailableSpawns(spawns) {
		return _.filter(spawns, spawn => {
			if (spawn.spawning) return false;

			return true;
		});
	}
};
