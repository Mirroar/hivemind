/* global ConstructionSite OBSTACLE_OBJECT_TYPES */

interface ConstructionSite {
	isWalkable,
}

/**
 * Checks whether a construction site can be moved onto.
 *
 * @return {boolean}
 *   True if a creep can move onto this construction site.
 */
ConstructionSite.prototype.isWalkable = function () {
	if (!this.my) return true;
	if (_.includes(OBSTACLE_OBJECT_TYPES, this.structureType)) return false;
	return true;
};
