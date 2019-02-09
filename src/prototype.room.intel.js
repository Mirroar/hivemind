'use strict';

/* global Room FIND_STRUCTURES STRUCTURE_CONTAINER
STRUCTURE_LINK STRUCTURE_LAB STRUCTURE_NUKER STRUCTURE_OBSERVER
STRUCTURE_POWER_SPAWN FIND_SOURCES FIND_MINERALS FIND_FLAGS */

const Bay = require('./manager.bay');
const BoostManager = require('./manager.boost');
const Exploit = require('./manager.exploit');

/**
 * Adds some additional data to room objects.
 */
Room.prototype.enhanceData = function () {
	this.addStructureReference(STRUCTURE_NUKER);
	this.addStructureReference(STRUCTURE_OBSERVER);
	this.addStructureReference(STRUCTURE_POWER_SPAWN);

	if (this.terminal && !this.terminal.isActive()) {
		delete this.terminal;
	}

	if (this.storage && !this.storage.isActive()) {
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

	// Initialize boost manager.
	if (BoostManager) {
		this.boostManager = new BoostManager(this.name);
	}
};

/**
* Gathers information about a rooms sources and saves it to memory for faster access.
*/
Room.prototype.scan = function () {
	const room = this;

	// Check if the controller has a container nearby.
	let structures = room.find(FIND_STRUCTURES, {
		filter: structure => structure.structureType === STRUCTURE_CONTAINER && structure.pos.getRangeTo(room.controller) <= 3,
	});
	if (structures && structures.length > 0) {
		room.memory.controllerContainer = structures[0].id;
	}
	else {
		delete room.memory.controllerContainer;
	}

	// Check if the controller has a link nearby.
	structures = room.find(FIND_STRUCTURES, {
		filter: structure => structure.structureType === STRUCTURE_LINK && structure.pos.getRangeTo(room.controller) <= 3,
	});
	if (structures && structures.length > 0) {
		room.memory.controllerLink = structures[0].id;
	}
	else {
		delete room.memory.controllerLink;
	}

	// Check if storage has a link nearby.
	if (room.storage) {
		structures = room.find(FIND_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_LINK && structure.pos.getRangeTo(room.storage) <= 3,
		});
		if (structures && structures.length > 0) {
			room.memory.storageLink = structures[0].id;
		}
		else {
			delete room.memory.storageLink;
		}
	}

	// Scan room for labs.
	// @todo Find labs not used for reactions, to do creep boosts.
	if (!room.memory.labsLastChecked || room.memory.labsLastChecked < Game.time - 3267) {
		room.memory.labsLastChecked = Game.time;
		room.memory.canPerformReactions = false;

		const labs = room.find(FIND_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_LAB && structure.isActive(),
		});
		if (labs.length >= 3) {
			// Find best 2 source labs for other labs to perform reactions.
			let best = null;
			for (const i in labs) {
				const lab = labs[i];

				const closeLabs = lab.pos.findInRange(FIND_STRUCTURES, 2, {
					filter: structure => structure.structureType === STRUCTURE_LAB && structure.id !== lab.id,
				});
				if (closeLabs.length < 2) continue;

				for (const j in closeLabs) {
					const lab2 = closeLabs[j];

					const reactors = [];
					for (const k in closeLabs) {
						const reactor = closeLabs[k];
						if (reactor === lab || reactor === lab2) continue;
						if (reactor.pos.getRangeTo(lab2) > 2) continue;

						reactors.push(reactor.id);
					}

					if (reactors.length === 0) continue;
					if (!best || best.reactor.length < reactors.length) {
						best = {
							source1: lab.id,
							source2: lab2.id,
							reactor: reactors,
						};
					}
				}
			}

			if (best) {
				room.memory.canPerformReactions = true;
				room.memory.labs = best;
			}
		}
	}
};

Room.prototype.needsScout = function () {
	if (!Memory.strategy) {
		return false;
	}

	const memory = Memory.strategy;

	for (const roomName in memory.roomList) {
		const info = memory.roomList[roomName];

		if (info.origin === this.name && info.scoutPriority >= 1) {
			return true;
		}
	}

	return false;
};
