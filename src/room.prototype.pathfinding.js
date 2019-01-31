'use strict';

/* global hivemind Room PathFinder FIND_STRUCTURES FIND_MY_CONSTRUCTION_SITES
STRUCTURE_ROAD STRUCTURE_CONTAINER STRUCTURE_RAMPART STRUCTURE_KEEPER_LAIR */

const utilities = require('./utilities');

Room.prototype.getCostMatrix = function () {
	return utilities.getCostMatrix(this.name);
};

/**
 * Generates a new CostMatrix for pathfinding in this room.
 */
Room.prototype.generateCostMatrix = function (structures, constructionSites) {
	const costs = new PathFinder.CostMatrix();

	if (!structures) {
		structures = this.find(FIND_STRUCTURES);
	}

	if (!constructionSites) {
		constructionSites = this.find(FIND_MY_CONSTRUCTION_SITES);
	}

	_.each(structures, structure => {
		if (structure.structureType === STRUCTURE_ROAD) {
			// Only do this if no structure is on the road.
			if (costs.get(structure.pos.x, structure.pos.y) <= 0) {
				// Favor roads over plain tiles.
				costs.set(structure.pos.x, structure.pos.y, 1);
			}
		}
		else if (structure.structureType !== STRUCTURE_CONTAINER && (structure.structureType !== STRUCTURE_RAMPART || !structure.my)) {
			// Can't walk through non-walkable buildings.
			costs.set(structure.pos.x, structure.pos.y, 0xFF);
		}
	});

	_.each(constructionSites, structure => {
		if (structure.structureType !== STRUCTURE_ROAD && structure.structureType !== STRUCTURE_CONTAINER && structure.structureType !== STRUCTURE_RAMPART) {
			// Can't walk through non-walkable construction sites.
			costs.set(structure.pos.x, structure.pos.y, 0xFF);
		}
	});

	return costs;
};

/**
 * Calculates a list of room names for traveling to a target room.
 */
Room.prototype.calculateRoomPath = function (targetRoom) {
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
	let finalPath;
	while (_.size(openList) > 0) {
		let minDist;
		let nextRoom;
		for (const rName in openList) {
			const info = openList[rName];
			if (!minDist || info.range + info.dist < minDist) {
				minDist = info.range + info.dist;
				nextRoom = rName;
			}
		}

		if (!nextRoom) {
			break;
		}

		const info = openList[nextRoom];

		// We're done if we reached targetRoom.
		if (nextRoom === targetRoom) {
			finalPath = info.path;
		}

		// Add unhandled adjacent rooms to open list.
		const exits = hivemind.roomIntel(nextRoom).getExits();
		for (const i in exits) {
			const exit = exits[i];
			if (openList[exit] || closedList[exit]) continue;

			const exitIntel = hivemind.roomIntel(exit);
			if (exitIntel.isOwned()) continue;
			// @todo Allow pathing through source keeper rooms if we can safely avoid them.
			if (_.size(exitIntel.getStructures(STRUCTURE_KEEPER_LAIR)) > 0) continue;

			const path = [];
			for (const i in info.path) {
				path.push(info.path[i]);
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

