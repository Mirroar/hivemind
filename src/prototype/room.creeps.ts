/**
 * Contains room prototype enhancements concerned with managing creeps.
 */

/* global Room */

declare global {
	interface Room {
		getCreepsWithOrder: (type: string, target: string) => Creep[];
	}
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
Room.prototype.getCreepsWithOrder = function (this: Room, type: string, target): Creep[] {
	// @todo Make sure this works with new dispatcher system.

	return _.filter(this.creeps, creep => {
		if (!creep.memory.order) return false;
		if (creep.memory.order.type !== type) return false;
		if (creep.memory.order.target && creep.memory.order.target !== target) return false;
		if (creep.memory.order.name && creep.memory.order.name !== target) return false;

		return true;
	});
};

export {};
