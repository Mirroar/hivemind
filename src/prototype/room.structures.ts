/* global Room STRUCTURE_LINK CONTROLLER_STRUCTURES FIND_STRUCTURES */

import Bay from 'manager.bay';
import cache from 'utils/cache';
import LinkNetwork from 'link-network';

declare global {
	interface Room {
		structures: AnyStructure[];
		structuresByType: {
			[STRUCTURE_CONTAINER]: StructureContainer[];
			[STRUCTURE_EXTENSION]: StructureExtension[];
			[STRUCTURE_EXTRACTOR]: StructureExtractor[];
			[STRUCTURE_FACTORY]: StructureFactory[];
			[STRUCTURE_LAB]: StructureLab[];
			[STRUCTURE_LINK]: StructureLink[];
			[STRUCTURE_NUKER]: StructureNuker[];
			[STRUCTURE_OBSERVER]: StructureObserver[];
			[STRUCTURE_POWER_SPAWN]: StructurePowerSpawn[];
			[STRUCTURE_RAMPART]: StructureRampart[];
			[STRUCTURE_SPAWN]: StructureSpawn[];
			[STRUCTURE_TOWER]: StructureTower[];
			[STRUCTURE_WALL]: StructureWall[];
		};
		myStructures: AnyOwnedStructure[];
		myStructuresByType: {
			[STRUCTURE_EXTENSION]: StructureExtension[];
			[STRUCTURE_EXTRACTOR]: StructureExtractor[];
			[STRUCTURE_FACTORY]: StructureFactory[];
			[STRUCTURE_LAB]: StructureLab[];
			[STRUCTURE_LINK]: StructureLink[];
			[STRUCTURE_NUKER]: StructureNuker[];
			[STRUCTURE_OBSERVER]: StructureObserver[];
			[STRUCTURE_POWER_SPAWN]: StructurePowerSpawn[];
			[STRUCTURE_RAMPART]: StructureRampart[];
			[STRUCTURE_SPAWN]: StructureSpawn[];
			[STRUCTURE_TOWER]: StructureTower[];
			[STRUCTURE_WALL]: StructureWall[];
		};
		generateLinkNetwork: () => void;
		isClearingTerminal: () => boolean;
		isClearingStorage: () => boolean;
		isEvacuating: () => boolean;
		linkNetwork: LinkNetwork;
		setClearingTerminal: (clear: boolean) => void;
		setEvacuating: (evacuate: boolean) => void;
		getEnergyStructures: () => Array<StructureSpawn | StructureExtension>;
		isStripmine: () => boolean;
		setStripmine: (stripmine: boolean) => void;
	}

	interface RoomMemory {
		isEvacuating?: boolean;
		isStripmine?: boolean;
		isClearingTerminal?: boolean;
	}
}

// Define quick access property room.structures.
Object.defineProperty(Room.prototype, 'structures', {
	get(this: Room) {
		return cacheStructures(this).all;
	},
	enumerable: false,
	configurable: true,
});

// Define quick access property room.structuresByType.
Object.defineProperty(Room.prototype, 'structuresByType', {
	get(this: Room) {
		return cacheStructures(this).byType;
	},
	enumerable: false,
	configurable: true,
});

// Define quick access property room.myStructures.
Object.defineProperty(Room.prototype, 'myStructures', {
	get(this: Room) {
		return cacheStructures(this).mine;
	},
	enumerable: false,
	configurable: true,
});

// Define quick access property room.myStructuresByType.
Object.defineProperty(Room.prototype, 'myStructuresByType', {
	get(this: Room) {
		return cacheStructures(this).mineByType;
	},
	enumerable: false,
	configurable: true,
});

function cacheStructures(room: Room) {
	return cache.inObject(room, 'allStructures', 1, () => {
		const structures = room.find(FIND_STRUCTURES);
		const myStructures = [];
		const structuresByType = {};
		const myStructuresByType = {};

		for (const structure of structures) {
			if (!structuresByType[structure.structureType]) {
				structuresByType[structure.structureType] = [];
			}

			structuresByType[structure.structureType].push(structure);

			if ('my' in structure && structure.my) {
				myStructures.push(structure);
				if (!myStructuresByType[structure.structureType]) {
					myStructuresByType[structure.structureType] = [];
				}

				myStructuresByType[structure.structureType].push(structure);
			}
		}

		return {
			all: structures,
			mine: myStructures,
			byType: structuresByType,
			mineByType: myStructuresByType,
		};
	});
}

/**
 * Creates and populates a room's link network.
 */
Room.prototype.generateLinkNetwork = function (this: Room) {
	const links = _.filter(
		this.myStructuresByType[STRUCTURE_LINK],
		s => s.isOperational(),
	);

	if (links.length <= 0) {
		return;
	}

	this.linkNetwork = new LinkNetwork();
	// @todo Controller and source links should be gotten through functions that
	// use the room planner.
	const controllerLinkId = this.memory.controllerLink;
	const sourceLinkIds = [];
	for (const source of this.sources) {
		const link = source.getNearbyLink();
		if (!link) continue;

		sourceLinkIds.push(link.id);
	}

	// Add links to network.
	for (const link of links) {
		if (link.id === controllerLinkId) {
			if (sourceLinkIds.includes(link.id)) {
				this.linkNetwork.addInOutLink(link);
			}
			else {
				this.linkNetwork.addOutLink(link);
			}
		}
		else if (sourceLinkIds.includes(link.id)) {
			this.linkNetwork.addInLink(link);
		}
		else {
			this.linkNetwork.addNeutralLink(link);
		}
	}
};

/**
 * Starts evacuation process for a room to prepare it for being abandoned.
 *
 * @param {boolean} evacuate
 *   Whether to evacuate this room or not.
 */
Room.prototype.setEvacuating = function (this: Room, evacuate: boolean) {
	this.memory.isEvacuating = evacuate;
};

/**
* Checks if a room is currently evacuating.
*
* @return {boolean}
*   Whether this room should be evacuated.
*/
Room.prototype.isEvacuating = function (this: Room) {
	return this.memory.isEvacuating && this.terminal?.isOperational();
};

Room.prototype.setStripmine = function (this: Room, enable: boolean) {
	this.memory.isStripmine = enable;
};

Room.prototype.isStripmine = function (this: Room) {
	return this.memory.isStripmine;
};

/**
* Starts emptying a rooms terminal and keeps it empty.
*
* @param {boolean} clear
*   Whether to clear this room's terminal.
*/
Room.prototype.setClearingTerminal = function (this: Room, clear: boolean) {
	this.memory.isClearingTerminal = clear;
};

/**
* Checks if a room's terminal should be emptied.
*
* @return {boolean}
*   Whether this room's terminal is being cleared.
*/
Room.prototype.isClearingTerminal = function (this: Room) {
	if (!this.terminal) return false;

	if (this.storage && this.roomManager && this.roomManager.hasMisplacedTerminal()) {
		return true;
	}

	return this.memory.isClearingTerminal;
};

/**
 * Checks if a room's storage should be emptied.
 */
Room.prototype.isClearingStorage = function (this: Room) {
	if (!this.storage) return false;
	if (this.isClearingTerminal()) return false;

	if (this.isEvacuating()) return true;
	if (this.terminal && this.roomManager && this.roomManager.hasMisplacedStorage()) {
		return true;
	}

	return false;
};

Room.prototype.getEnergyStructures = function (this: Room): Array<StructureSpawn | StructureExtension> {
	if (!this.roomPlanner) return undefined;

	// Short cache time, because priority of bays may shift as sources deplete.
	const ids = cache.inHeap('energyStructures:' + this.name, 1, () => {
		const structures: Array<Id<StructureSpawn | StructureExtension>> = [];

		for (const bay of getBaysByPriority(this)) {
			for (const structure of bay.extensions) {
				if (structure.structureType !== STRUCTURE_SPAWN && structure.structureType !== STRUCTURE_EXTENSION) continue;

				structures.push(structure.id);
			}
		}

		// Add energy structures outside of bays last, because they're less
		// efficient to refill.
		for (const structure of getUnmappedEnergyStructures(this, structures)) {
			structures.push(structure.id);
		}

		return structures;
	});

	return _.map<Id<StructureSpawn | StructureExtension>, StructureSpawn | StructureExtension>(ids, Game.getObjectById);
};

function getBaysByPriority(room: Room): Bay[] {
	const center = room.roomPlanner.getRoomCenter();
	return _.sortBy(room.bays, bay => {
		if (bay.energyCapacity <= 0) return 999;

		// Prefer partially filled bays. Lower priority means empty it first.
		let priority = bay.energy / bay.energyCapacity;

		// Greatly prefer emptying bays filled by harvesters.
		// Unless they don't have enough reserves.
		for (const source of room.sources) {
			if (source.pos.getRangeTo(bay.pos) > 1) continue;

			const missingEnergy = Math.max(0, source.energy + bay.energyCapacity - (source.getNearbyContainer()?.store[RESOURCE_ENERGY] || 0));
			priority = missingEnergy / bay.energyCapacity;
			break;
		}

		// Lastly, closer bays get preferred.
		const distance = center.getRangeTo(bay.pos);
		return priority + distance / 50;
	});
}

function getUnmappedEnergyStructures(room: Room, map: Array<Id<Structure>>): Array<StructureSpawn | StructureExtension> {
	const center = room.roomPlanner.getRoomCenter();
	return _.sortBy(
		_.filter(
			[...(room.myStructuresByType[STRUCTURE_SPAWN] || []), ...(room.myStructuresByType[STRUCTURE_EXTENSION] || [])],
			s => !map.includes(s.id) && s.isOperational(),
		),
		s => s.pos.getRangeTo(center),
	);
}
