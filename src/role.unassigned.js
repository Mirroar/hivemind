'use strict';

/* global CLAIM WORK */

const Role = require('./role');

const UnassignedRole = function () {
	Role.call(this);
};

UnassignedRole.prototype = Object.create(Role.prototype);

/**
 * Assigns a new role to this creep.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
UnassignedRole.prototype.run = function (creep) {
	// Make this creep a scout by default.
	creep.memory = {
		role: 'scout',
		origin: creep.room.name,
		body: {},
	};

	// Recaulculate body part counts.
	for (const part of creep.body) {
		creep.memory.body[part.type] = (creep.memory.body[part.type] || 0) + 1;
	}

	// Creeps with claim parts are sent as part of intershard expansion.
	if (creep.memory.body[CLAIM] > 0) {
		creep.memory.role = 'brawler';
		creep.memory.squadUnitType = 'singleClaim';
		creep.memory.squadName = 'interShardExpansion';
	}

	// Creeps with work parts are sent as part of intershard expansion.
	if (creep.memory.body[WORK] > 0) {
		creep.memory.role = 'brawler';
		creep.memory.squadUnitType = 'builder';
		creep.memory.squadName = 'interShardExpansion';
	}
};

module.exports = UnassignedRole;
