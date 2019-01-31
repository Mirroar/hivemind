'use strict';

/* global Structure OBSTACLE_OBJECT_TYPES STRUCTURE_RAMPART */

if (!Structure.prototype.__enhancementsLoaded) {
	/**
	 * Checks whether a structure can be moved onto.
	 *
	 * @return {boolean}
	 *   True if a creep can move onto this structure.
	 */
	Structure.prototype.isWalkable = function () {
		if (_.includes(OBSTACLE_OBJECT_TYPES, this.structureType)) return false;
		if (this.structureType === STRUCTURE_RAMPART) {
			return this.my || this.isPublic();
		}

		return true;
	};
}
