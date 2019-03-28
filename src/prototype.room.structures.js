'use strict';

/* global hivemind Room FIND_MY_STRUCTURES STRUCTURE_LINK CONTROLLER_STRUCTURES
FIND_STRUCTURES */

const LinkNetwork = require('./link-network');

/**
 * Moves creep within a certain range of a target.
 */
Room.prototype.generateLinkNetwork = function () {
	const links = this.find(FIND_MY_STRUCTURES, {
		filter: s => s.structureType === STRUCTURE_LINK && s.isActive(),
	});

	if (links.length <= 0) {
		return;
	}

	this.linkNetwork = new LinkNetwork();
	// @todo Controller and source links should be gotten through functions that
	// use the room planner.
	const controllerLinkId = this.memory.controllerLink;
	const sourceLinkIds = [];
	if (this.memory.sources) {
		for (const id in this.memory.sources) {
			if (this.memory.sources[id].targetLink) {
				sourceLinkIds.push(this.memory.sources[id].targetLink);
			}
		}
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

Room.prototype.addStructureReference = function (structureType) {
	if (!this.controller) return;

	if (!this.memory.structureCache) {
		this.memory.structureCache = {};
	}

	const cache = this.memory.structureCache;

	if (!cache[structureType] || Game.time - cache[structureType].lastCheck > 250 * hivemind.getThrottleMultiplier()) {
		cache[structureType] = {
			lastCheck: Game.time,
		};

		if (CONTROLLER_STRUCTURES[structureType][this.controller.level] === 0) return;

		// @todo Cache filtered find requests in room.
		const structures = this.find(FIND_STRUCTURES, {filter: {structureType}});

		if (structures.length > 0) {
			cache[structureType].id = structures[0].id;
		}
	}

	if (cache[structureType].id) {
		this[structureType] = Game.getObjectById(cache[structureType].id);

		if (!this[structureType]) {
			delete cache[structureType].id;
		}
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
	return this.memory.isClearingTerminal;
};
