'use strict';

const SpawnManager = function () {
	this.roles = {};
};

/**
 * Registers a role to be managed.
 *
 * @param {String} roleId
 *   Identifier of the role, as stored in a creep's memory.
 * @param {Role} role
 *   The role to register.
 */
SpawnManager.prototype.registerSpawnRole = function (roleId, role) {
	this.roles[roleId] = role;
};

/**
 * Collects spawn options from all spawn roles.
 *
 * @param {Room} room
 *   The room to use as context for spawn roles.
 *
 * @return {object[]}
 *   An array of possible spawn options for the current room.
 */
SpawnManager.prototype.getAllSpawnOptions = function (room) {
	const options = [];

	_.each(this.roles, role => {
		if (role.getSpawnOptions) {
			role.getSpawnOptions(room, options);
		}
	});

	return options;
};

/**
 * Filters a list of spawns to only those available for spawning.
 *
 * @param {StructureSpawn[]} spawns
 *   The list of spawns to filter.
 *
 * @return {StructureSpawn[]}
 *   An array containing all spawns where spawning is possible.
 */
SpawnManager.prototype.filterAvailableSpawns = function (spawns) {
	return _.filter(spawns, spawn => {
		if (spawn.spawning) return false;

		return true;
	});
};

/**
 * Manages spawning in a room.
 *
 * @param {Room} room
 *   The room to manage spawning in.
 * @param {StructureSpawn[]} spawns
 *   The room's spawns.
 */
SpawnManager.prototype.manageSpawns = function (room, spawns) {
	const availableSpawns = this.filterAvailableSpawns(spawns);
	if (availableSpawns.length === 0) return;

	const options = this.getAllSpawnOptions(room);
	const option = _.sample(options);
	const role = this.roles[option.role];
	const body = role.getBody(room, option);

	const spawn = _.sample(availableSpawns);
	spawn.spawnCreep(body, '', {});
};

module.exports = SpawnManager;
