/**
 * Contains room prototype enhancements concerned with managing creeps.
 */

'use strict';

/* global Room */

/**
 * Finds all creeps in this room with a given order.
 *
 * @param {string} type
 *   The type of order to look for.
 * @param {object} target
 *   The target of the order.
 *
 * @return {Creep[]}
 *   An array of creeps that have a matching order.
 */
Room.prototype.getCreepsWithOrder = function (type, target) {
	return _.filter(this.creeps, creep => {
		if (creep.memory.order) {
			if (creep.memory.order.type === type && creep.memory.order.target === target) {
				return true;
			}
		}

		return false;
	});
};
