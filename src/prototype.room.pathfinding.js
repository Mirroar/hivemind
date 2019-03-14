'use strict';

/* global hivemind Room FIND_STRUCTURES FIND_MY_CONSTRUCTION_SITES
STRUCTURE_KEEPER_LAIR */

const utilities = require('./utilities');

Room.prototype.getCostMatrix = function () {
	return utilities.getCostMatrix(this.name);
};

/**
 * Generates a new CostMatrix for pathfinding in this room.
 *
 * @param {Array} structures
 *   An array of structures to navigate around.
 * @param {Array} constructionSites
 *   An array of construction sites to navigate around.
 *
 * @return {PathFinder.CostMatrix}
 *   A cost matrix representing this room.
 */
Room.prototype.generateCostMatrix = function (structures, constructionSites) {
	if (!structures) {
		structures = _.groupBy(this.find(FIND_STRUCTURES), 'structureType');
	}

	if (!constructionSites) {
		constructionSites = _.groupBy(this.find(FIND_MY_CONSTRUCTION_SITES), 'structureType');
	}

	return utilities.generateCostMatrix(structures, constructionSites);
};

/**
 * Calculates a list of room names for traveling to a target room.
 *
 * @param {string} targetRoom
 *   Name of the room to navigate to.
 * @param {boolean} allowDanger
 *   If true, creep may move through unsafe rooms.
 *
 * @return {string[]}
 *   An array of room names a creep needs to move throught to reach targetRoom.
 */
Room.prototype.calculateRoomPath = function (targetRoom, allowDanger) {
	const roomName = this.name;

	const openList = {};
	const closedList = {};

	openList[roomName] = {
		range: 0,
		dist: Game.map.getRoomLinearDistance(roomName, targetRoom),
		origin: roomName,
		path: [],
	};

	// A* from here to targetRoom.
	// @todo Avoid unsafe rooms.
	// @todo Some rooms' obstacles prevent moving from one exit to another,
	// but we can deduce that from the cost matrixes we store.
	let finalPath;
	while (_.size(openList) > 0) {
		let minDist;
		let nextRoom;
		_.each(openList, (info, rName) => {
			if (!minDist || info.range + info.dist < minDist) {
				minDist = info.range + info.dist;
				nextRoom = rName;
			}
		});

		if (!nextRoom) break;

		const info = openList[nextRoom];

		// We're done if we reached targetRoom.
		if (nextRoom === targetRoom) {
			finalPath = info.path;
		}

		// Add unhandled adjacent rooms to open list.
		const exits = hivemind.roomIntel(nextRoom).getExits();
		for (const exit of _.values(exits)) {
			if (openList[exit] || closedList[exit]) continue;

			const exitIntel = hivemind.roomIntel(exit);
			if (!allowDanger) {
				if (exitIntel.isOwned()) continue;
				// @todo Allow pathing through source keeper rooms if we can safely avoid them.
				if (_.size(exitIntel.getStructures(STRUCTURE_KEEPER_LAIR)) > 0) continue;
			}

			const path = [];
			for (const step of info.path) {
				path.push(step);
			}

			path.push(exit);

			openList[exit] = {
				range: info.range + 1,
				dist: Game.map.getRoomLinearDistance(exit, targetRoom),
				origin: info.origin,
				path,
			};
		}

		delete openList[nextRoom];
		closedList[nextRoom] = true;
	}

	return finalPath;
};
