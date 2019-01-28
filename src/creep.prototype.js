'use strict';

/* global hivemind Creep MOVE CARRY TOUGH ERR_NOT_ENOUGH_RESOURCES
RESOURCE_ENERGY STRUCTURE_LINK */

if (!Creep.prototype.__enhancementsLoaded) {
	require('./creep.prototype.movement');

	/**
	 * Determines if a creep is dangerous and should be attacked.
	 *
	 * @return {boolean}
	 *   True if the creep can be considered dangerous in some way.
	 */
	Creep.prototype.isDangerous = function () {
		if (hivemind.relations.isAlly(this.owner.username)) return false;

		for (const part of this.body) {
			if (part.type !== MOVE && part.type !== CARRY && part.type !== TOUGH) {
				return true;
			}
		}

		return false;
	};

	/**
	 * Transfer resources to a target, if the creep carries any.
	 *
	 * @param {RoomObject} target
	 *   The target to transfer resources to.
	 *
	 * @return {number}
	 *   Error codes as in Creep.transfer().
	 */
	Creep.prototype.transferAny = function (target) {
		for (const resourceType in this.carry) {
			if (target.structureType === STRUCTURE_LINK && resourceType !== RESOURCE_ENERGY) continue;
			if (this.carry[resourceType] > 0) {
				return this.transfer(target, resourceType);
			}
		}

		return ERR_NOT_ENOUGH_RESOURCES;
	};

	/**
	 * Drop resources on the ground, if the creep carries any.
	 *
	 * @return {number}
	 *   Error codes as in Creep.drop().
	 */
	Creep.prototype.dropAny = function () {
		for (const resourceType in this.carry) {
			if (this.carry[resourceType] > 0) {
				return this.drop(resourceType);
			}
		}

		return ERR_NOT_ENOUGH_RESOURCES;
	};

	Creep.prototype.__enhancementsLoaded = true;
}
