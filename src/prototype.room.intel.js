'use strict';

/* global Room FIND_STRUCTURES STRUCTURE_CONTAINER
STRUCTURE_LINK STRUCTURE_NUKER STRUCTURE_OBSERVER
STRUCTURE_POWER_SPAWN FIND_SOURCES FIND_MINERALS FIND_FLAGS */

const Bay = require('./manager.bay');
const Exploit = require('./manager.exploit');

/**
 * Adds some additional data to room objects.
 */
Room.prototype.enhanceData = function () {
	this.addStructureReference(STRUCTURE_NUKER);
	this.addStructureReference(STRUCTURE_OBSERVER);
	this.addStructureReference(STRUCTURE_POWER_SPAWN);

	if (this.terminal && !this.terminal.isOperational()) {
		delete this.terminal;
	}

	if (this.storage && !this.storage.isOperational()) {
		delete this.storage;
	}

	// Prepare memory for creep cache (filled globally later).
	if (!this.creeps) {
		this.creeps = {};
		this.creepsByRole = {};
	}

	// Register sources and minerals.
	this.sources = this.find(FIND_SOURCES);
	for (const source of this.sources) {
		source.enhanceData();
	}

	const minerals = this.find(FIND_MINERALS);
	for (const mineral of minerals) {
		this.mineral = mineral;
		this.mineral.enhanceData();
	}

	// Register bays.
	this.bays = [];
	if (this.controller && this.controller.my) {
		const flags = this.find(FIND_FLAGS, {
			filter: flag => flag.name.startsWith('Bay:'),
		});
		for (const flag of flags) {
			try {
				this.bays.push(new Bay(flag.name));
			}
			catch (error) {
				console.log('Error when initializing Bays:', error);
				console.log(error.stack);
			}
		}
	}

	// Register exploits.
	this.exploits = {};
	if (this.controller && this.controller.level >= 7) {
		const flags = _.filter(Game.flags, flag => flag.name.startsWith('Exploit:' + this.name + ':'));
		for (const flag of flags) {
			try {
				this.exploits[flag.pos.roomName] = new Exploit(this, flag.name);
				Game.exploits[flag.pos.roomName] = this.exploits[flag.pos.roomName];
			}
			catch (error) {
				console.log('Error when initializing Exploits:', error);
				console.log(error.stack);
			}
		}
	}
};

/**
* Gathers information about a room and saves it to memory for faster access.
*/
Room.prototype.scan = function () {
	this.updateControllerContainer();
	this.updateControllerLink();
	this.updateStorageLink();
};

/**
 * Updates location of the room's controller container.
 */
Room.prototype.updateControllerContainer = function () {
	// Check if the controller has a container nearby.
	// Use room planner locations if available.
	if (this.roomPlanner) {
		const containerPositions = this.roomPlanner.getLocations('container.controller');
		if (containerPositions.length > 0) {
			const structures = this.find(FIND_STRUCTURES, {
				filter: structure => structure.structureType === STRUCTURE_CONTAINER &&
				_.filter(containerPositions, pos => pos.x === structure.pos.x && pos.y === structure.pos.y).length > 0,
			});
			this.memory.controllerContainer = structures.length > 0 && structures[0].id;
			return;
		}
	}

	const structures = this.find(FIND_STRUCTURES, {
		filter: structure => structure.structureType === STRUCTURE_CONTAINER && structure.pos.getRangeTo(this.controller) <= 3,
	});
	this.memory.controllerContainer = structures.length > 0 && structures[0].id;
};

/**
 * Updates location of the room's controller link.
 */
Room.prototype.updateControllerLink = function () {
	// Check if the controller has a link nearby.
	// Use room planner locations if available.
	if (this.roomPlanner) {
		const linkPositions = this.roomPlanner.getLocations('link.controller');
		if (linkPositions.length > 0) {
			const structures = this.find(FIND_STRUCTURES, {
				filter: structure => structure.structureType === STRUCTURE_LINK &&
				_.filter(linkPositions, pos => pos.x === structure.pos.x && pos.y === structure.pos.y).length > 0,
			});
			this.memory.controllerLink = structures.length > 0 && structures[0].id;
			return;
		}
	}

	const structures = this.find(FIND_STRUCTURES, {
		filter: structure => structure.structureType === STRUCTURE_LINK && structure.pos.getRangeTo(this.controller) <= 3,
	});
	this.memory.controllerLink = structures.length > 0 && structures[0].id;
};

/**
 * Updates location of the room's storage link.
 */
Room.prototype.updateStorageLink = function () {
	if (!this.storage) return;

	// Check if storage has a link nearby.
	// Use room planner locations if available.
	if (this.roomPlanner) {
		const linkPositions = this.roomPlanner.getLocations('link.storage');
		if (linkPositions.length > 0) {
			const structures = this.find(FIND_STRUCTURES, {
				filter: structure => structure.structureType === STRUCTURE_LINK &&
				_.filter(linkPositions, pos => pos.x === structure.pos.x && pos.y === structure.pos.y).length > 0,
			});
			this.memory.storageLink = structures.length > 0 && structures[0].id;
			return;
		}
	}

	const structures = this.find(FIND_STRUCTURES, {
		filter: structure => structure.structureType === STRUCTURE_LINK && structure.pos.getRangeTo(this.storage) <= 3,
	});
	this.memory.storageLink = structures.length > 0 && structures[0].id;
};

/**
 * Decides if this room needs to send out a scout.
 *
 * @return {boolean}
 *   True if a scout is needed.
 */
Room.prototype.needsScout = function () {
	if (!Memory.strategy) return false;

	const room = this;
	return _.any(Memory.strategy.roomList, info => info.origin === room.name && info.scoutPriority >= 1);
};
