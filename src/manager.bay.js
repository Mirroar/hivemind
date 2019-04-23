'use strict';

/* global RoomVisual COLOR_GREY FIND_STRUCTURES STRUCTURE_EXTENSION
OBSTACLE_OBJECT_TYPES LOOK_STRUCTURES RESOURCE_ENERGY */

/**
 * Bays collect extensions into a single entity for more efficient refilling.
 * @constructor
 *
 * @param {string} flagName
 *   Name of the flag around which this bay is positioned.
 */
const Bay = function (flagName) {
	this.flag = Game.flags[flagName];
	this.memory = this.flag.memory;
	this.pos = this.flag.pos;
	this.name = this.flag.name;

	if (this.flag.color !== COLOR_GREY) {
		this.flag.setColor(COLOR_GREY);
	}

	if (!this.memory.extensions || Game.time % 100 === 38) {
		const extensions = this.pos.findInRange(FIND_STRUCTURES, 1, {
			filter: structure => structure.structureType === STRUCTURE_EXTENSION && structure.isOperational(),
		});
		this.memory.extensions = _.map(extensions, 'id');
	}

	// Do not add extensions to bay if center is blocked by a structure.
	const posStructures = this.pos.lookFor(LOOK_STRUCTURES);
	let blocked = false;
	for (const structure of posStructures) {
		if (OBSTACLE_OBJECT_TYPES.indexOf(structure.structureType) !== -1) {
			blocked = true;
			break;
		}
	}

	this.extensions = [];
	this.energy = 0;
	this.energyCapacity = 0;

	if (blocked) return;

	if (this.memory.extensions) {
		for (const id of this.memory.extensions) {
			const extension = Game.getObjectById(id);
			if (!extension) continue;

			this.extensions.push(extension);
			this.energy += extension.energy;
			this.energyCapacity += extension.energyCapacity;
		}
	}

	// Draw bay.
	if (typeof RoomVisual !== 'undefined') {
		const visual = new RoomVisual(this.pos.roomName);
		visual.rect(this.pos.x - 1.4, this.pos.y - 1.4, 2.8, 2.8, {
			fill: 'rgba(255, 255, 128, 0.2)',
			opacity: 0.5,
			stroke: '#ffff80',
		});
	}
};

/**
 * Checks if an extension is part of this bay.
 *
 * @param {Structure} extension
 *   The structure to check.
 *
 * @return {boolean}
 *   True if this extension is registered with this bay.
 */
Bay.prototype.hasExtension = function (extension) {
	for (const ourExtension of this.extensions) {
		if (ourExtension.id === extension.id) return true;
	}

	return false;
};

/**
 * Refills this bay using energy carried by the given creep.
 *
 * @param {Creep} creep
 *   A creep with carry parts and energy in store.
 */
Bay.prototype.refillFrom = function (creep) {
	for (const extension of this.extensions) {
		if (extension.energy < extension.energyCapacity) {
			creep.transfer(extension, RESOURCE_ENERGY);
			break;
		}
	}
};

module.exports = Bay;
