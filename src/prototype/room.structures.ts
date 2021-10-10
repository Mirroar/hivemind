/* global Room FIND_MY_STRUCTURES STRUCTURE_LINK CONTROLLER_STRUCTURES
FIND_STRUCTURES */

declare global {
	interface Room {
		addStructureReference,
		generateLinkNetwork,
		isClearingTerminal,
		isClearingStorage,
		isEvacuating,
		linkNetwork: LinkNetwork,
		setClearingTerminal,
		setEvacuating,
	}
}

import cache from 'utils/cache';
import LinkNetwork from 'link-network';

/**
 * Moves creep within a certain range of a target.
 */
Room.prototype.generateLinkNetwork = function () {
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
			if (sourceLinkIds.indexOf(link.id) >= 0) {
				this.linkNetwork.addInOutLink(link);
			}
			else {
				this.linkNetwork.addOutLink(link);
			}
		}
		else if (sourceLinkIds.indexOf(link.id) >= 0) {
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
Room.prototype.addStructureReference = function (structureType) {
	if (!this.controller) return;

	const cacheKey = this.name + ':' + structureType + ':id';
	const structureId = cache.inHeap(cacheKey, 250, () => {
		if (CONTROLLER_STRUCTURES[structureType][this.controller.level] === 0) return;

		// @todo Cache filtered find requests in room.
		const structures = this.find(FIND_STRUCTURES, {filter: {structureType}});

		if (structures.length > 0) {
			return structures[0].id;
		}
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
Room.prototype.setEvacuating = function (evacuate) {
	this.memory.isEvacuating = evacuate;
};

/**
* Checks if a room is currently evacuating.
*
* @return {boolean}
*   Whether this room should be evacuated.
*/
Room.prototype.isEvacuating = function () {
	return this.memory.isEvacuating;
};

/**
* Starts emptying a rooms terminal and keeps it empty.
*
* @param {boolean} clear
*   Whether to clear this room's terminal.
*/
Room.prototype.setClearingTerminal = function (clear) {
	this.memory.isClearingTerminal = clear;
};

/**
* Checks if a room's terminal should be emptied.
*
* @return {boolean}
*   Whether this room's terminal is being cleared.
*/
Room.prototype.isClearingTerminal = function () {
	if (!this.terminal) return false;

	if (this.storage && this.roomManager && this.roomManager.hasMisplacedTerminal()) {
		if (this.storage.store.getFreeCapacity() > this.terminal.store.getUsedCapacity()) {
			return true;
		}
	}

	return this.memory.isClearingTerminal;
};

/**
 * Checks if a room's storage should be emptied.
 */
Room.prototype.isClearingStorage = function () {
	if (!this.storage) return false;
	if (this.isClearingTerminal()) return false;

	if (this.isEvacuating()) return true;
	if (this.terminal && this.roomManager && this.roomManager.hasMisplacedStorage()) {
		if (this.terminal.store.getFreeCapacity() > this.storage.store.getUsedCapacity()) {
			return true;
		}
	}

	return false;
};
