'use strict';

/* global hivemind Creep MOVE TOUGH ERR_NOT_ENOUGH_RESOURCES
RESOURCE_ENERGY STRUCTURE_LINK */

if (!Creep.prototype.__enhancementsLoaded) {
	require('./prototype.creep.movement');

	/**
	 * Determines if a creep is dangerous and should be attacked.
	 *
	 * @return {boolean}
	 *   True if the creep can be considered dangerous in some way.
	 */
	Creep.prototype.isDangerous = function () {
		if (hivemind.relations.isAlly(this.owner.username)) return false;

		for (const part of this.body) {
			if (part.type !== MOVE && part.type !== TOUGH) {
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

	/**
	 * Add additional data for each creep.
	 */
	Creep.prototype.enhanceData = function () {
		const role = this.memory.role;

		// Store creeps by role in global and room data.
		if (!Game.creepsByRole[role]) {
			Game.creepsByRole[role] = {};
		}

		Game.creepsByRole[role][this.name] = this;

		const room = this.room;
		if (!room.creeps) {
			room.creeps = {};
			room.creepsByRole = {};
		}

		room.creeps[this.name] = this;
		if (!room.creepsByRole[role]) {
			room.creepsByRole[role] = {};
		}

		room.creepsByRole[role][this.name] = this;

		// Store creeps that are part of a squad in their respectice squads.
		if (this.memory.squadName) {
			const squad = Game.squads[this.memory.squadName];
			if (squad) {
				if (!squad.units[this.memory.squadUnitType]) {
					squad.units[this.memory.squadUnitType] = [];
				}

				squad.units[this.memory.squadUnitType].push(this);
			}
		}

		// Store creeps that are part of an exploit operation in the correct object.
		if (this.memory.exploitName) {
			if (!Game.exploitTemp[this.memory.exploitName]) {
				Game.exploitTemp[this.memory.exploitName] = [];
			}

			Game.exploitTemp[this.memory.exploitName].push(this.id);
		}
	};

	Creep.prototype.__enhancementsLoaded = true;
}
