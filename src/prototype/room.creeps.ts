/**
 * Contains room prototype enhancements concerned with managing creeps.
 */

/* global Room */

interface Room {
  getCreepsWithOrder,
}

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
	return _.filter(this.creeps, (creep: Creep) => {
		if (!creep.memory.order) return false;
		if (creep.memory.order.type !== type) return false;
		if (creep.memory.order.target !== target) return false;

		return true;
	});
};
