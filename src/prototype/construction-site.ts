/* global ConstructionSite OBSTACLE_OBJECT_TYPES */

declare global {
	interface ConstructionSite {
		isWalkable: () => boolean;
	}
}

/**
 * Checks whether a construction site can be moved onto.
 *
 * @return {boolean}
 *   True if a creep can move onto this construction site.
 */
ConstructionSite.prototype.isWalkable = function (this: ConstructionSite): boolean {
	if (!this.my) return true;
	if (_.includes(OBSTACLE_OBJECT_TYPES, this.structureType)) return false;

	return true;
};

export {};
