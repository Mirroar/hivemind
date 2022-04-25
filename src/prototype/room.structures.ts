/* global Room FIND_MY_STRUCTURES STRUCTURE_LINK CONTROLLER_STRUCTURES
FIND_STRUCTURES */

import Bay from 'manager.bay';
import cache from 'utils/cache';
import LinkNetwork from 'link-network';

declare global {
	interface Room {
		addStructureReference: (structureType: StructureConstant) => void;
		generateLinkNetwork: () => void;
		isClearingTerminal: () => boolean;
		isClearingStorage: () => boolean;
		isEvacuating: () => boolean;
		linkNetwork: LinkNetwork;
		setClearingTerminal: (clear: boolean) => void;
		setEvacuating: (evacuate: boolean) => void;
		getEnergyStructures: () => Array<StructureSpawn | StructureExtension>;
	}

	interface RoomMemory {
		isEvacuating?: boolean;
		isClearingTerminal?: boolean;
	}
}

/**
 * Creates and populates a room's link network.
 */
Room.prototype.generateLinkNetwork = function (this: Room) {
	const links = this.find(FIND_MY_STRUCTURES, {
		filter: s => s.structureType === STRUCTURE_LINK && s.isOperational(),
	});

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
 * Adds short reference to a structure to a room object.
 *
 * @param {string} structureType
 *   Type of structure for which to create a reference.
 */
Room.prototype.addStructureReference = function (this: Room, structureType: StructureConstant) {
	if (!this.controller) return;

	const cacheKey = this.name + ':' + structureType + ':id';
	const structureId = cache.inHeap(cacheKey, 250, () => {
		if (CONTROLLER_STRUCTURES[structureType][this.controller.level] === 0) return null;

		// @todo Cache filtered find requests in room.
		const structures = this.find(FIND_STRUCTURES, {filter: {structureType}});

		if (structures.length > 0) {
			return structures[0].id;
		}

		return null;
	});

	if (!structureId) return;

	this[structureType] = Game.getObjectById(structureId);

	if (!this[structureType]) {
		cache.removeEntry(null, cacheKey);
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
	return this.memory.isEvacuating;
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

	const ids = cache.inHeap('energyStructures:' + this.name, 100, () => {
		const structures: Array<Id<StructureSpawn | StructureExtension>> = [];

		for (const bay of getBaysByPriority(this)) {
			for (const structure of bay.extensions) {
				if (structure.structureType !== STRUCTURE_SPAWN && structure.structureType !== STRUCTURE_EXTENSION) continue;

				structures.push(structure.id);
			}
		}

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
		// @todo Prefer partially filled bays.

		const distance = center.getRangeTo(bay.pos);
		if (_.min(_.map(room.find(FIND_SOURCES), source => source.pos.getRangeTo(bay.pos))) <= 1) return distance / 50;

		return 1 + distance / 50;
	});
}

function getUnmappedEnergyStructures(room: Room, map: Array<Id<Structure>>): Array<StructureSpawn | StructureExtension> {
	const center = room.roomPlanner.getRoomCenter();
	return _.sortBy(
		room.find(FIND_MY_STRUCTURES, {
			filter: s => ([STRUCTURE_SPAWN, STRUCTURE_EXTENSION] as string[]).includes(s.structureType) && !map.includes(s.id),
		}),
		s => s.pos.getRangeTo(center),
	);
}
