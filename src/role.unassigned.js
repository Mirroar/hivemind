'use strict';

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
	// Just make this creep a scout by default.
	// @todo Enhance this once we send workers through inter-shard portals.
	creep.memory = {
		role: 'scout',
		origin: creep.room.name,
	};
};

module.exports = UnassignedRole;
