/* global Creep ERR_NOT_ENOUGH_RESOURCES RESOURCE_ENERGY STRUCTURE_LINK */

import 'prototype/creep.military';
import 'prototype/creep.movement';
import 'prototype/creep.train';
import {getResourcesIn} from 'utils/store';

declare global {
	interface Creep {
		heapMemory: CreepHeapMemory;
		transferAny: (target: Structure) => ScreepsReturnCode;
		dropAny: () => ScreepsReturnCode;
		enhanceData: () => void;
	}

	interface PowerCreep {
		heapMemory: CreepHeapMemory;
	}

	interface CreepHeapMemory {}
}

// @todo Periodically clear heap memory of deceased creeps.
let creepHeapMemory: Record<string, CreepHeapMemory | PowerCreepHeapMemory> = {};

function clearHeapMemory() {
	creepHeapMemory = {};
}

// Define quick access property creep.heapMemory.
Object.defineProperty(Creep.prototype, 'heapMemory', {

	/**
	 * Gets semi-persistent memory for a creep.
	 *
	 * @return {Operation}
	 *   The heap memory object for this creep.
	 */
	get() {
		if (!creepHeapMemory[this.id]) creepHeapMemory[this.id] = {} as CreepHeapMemory;

		return creepHeapMemory[this.id];
	},
	enumerable: false,
	configurable: true,
});

// Define quick access property powerCreep.heapMemory.
Object.defineProperty(PowerCreep.prototype, 'heapMemory', {

	/**
	 * Gets semi-persistent memory for a power creep.
	 *
	 * @return {Operation}
	 *   The operation this creep belongs to.
	 */
	get() {
		if (!creepHeapMemory[this.id]) creepHeapMemory[this.id] = {} as PowerCreepHeapMemory;

		return creepHeapMemory[this.id];
	},
	enumerable: false,
	configurable: true,
});

// Define quick access property creep.operation.
Object.defineProperty(Creep.prototype, 'operation', {

	/**
	 * Gets the operation this creep belongs to, if any.
	 *
	 * @return {Operation}
	 *   The operation this creep belongs to.
	 */
	get() {
		return Game.operations[this.memory.operation || ''];
	},
	enumerable: false,
	configurable: true,
});

/**
 * Transfer resources to a target, if the creep carries any.
 *
 * @param {RoomObject} target
 *   The target to transfer resources to.
 *
 * @return {number}
 *   Error codes as in Creep.transfer().
 */
Creep.prototype.transferAny = function (this: Creep, target: Structure): ScreepsReturnCode {
	for (const resourceType of getResourcesIn(this.store)) {
		if (target.structureType === STRUCTURE_LINK && resourceType !== RESOURCE_ENERGY) continue;
		if (this.store[resourceType] > 0) {
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
Creep.prototype.dropAny = function (this: Creep): ScreepsReturnCode {
	for (const resourceType of getResourcesIn(this.store)) {
		if (this.store[resourceType] > 0) {
			return this.drop(resourceType);
		}
	}

	return ERR_NOT_ENOUGH_RESOURCES;
};

/**
 * Add additional data for each creep.
 */
Creep.prototype.enhanceData = function (this: Creep) {
	if (!this.memory.role) {
		this.memory.role = 'unassigned';
	}

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

	// Store creeps that are part of a squad in the correct object.
	if (this.memory.squadName) {
		const unitType = this.memory.squadUnitType || this.memory.role;
		if (!Game.creepsBySquad[this.memory.squadName]) {
			Game.creepsBySquad[this.memory.squadName] = {};
		}
		if (!Game.creepsBySquad[this.memory.squadName][unitType]) {
			Game.creepsBySquad[this.memory.squadName][unitType] = {};
		}
		Game.creepsBySquad[this.memory.squadName][unitType][this.name] = this;
	}
};

export {
	clearHeapMemory,
};
