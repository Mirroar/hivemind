import cache from 'utils/cache';

import {encodePosition} from 'utils/serialization';
import {getRoomIntel} from 'room-intel';
import {handleMapArea} from 'utils/map';

/**
 * Gets the pathfinding cost matrix for a room.
 *
 * @param {string} roomName
 *   Name of the room.
 * @param {object} options
 *   Further options regarding the matrix. Can have the following keys:
 *   - `singleRoom`: If true, return a matrix for creeps that cannot leave
 *     the room.
 *
 * @return {PathFinder.CostMatrix}
 *   The requested cost matrix.
 */
function getCostMatrix(roomName, options?: any): CostMatrix {
	if (!options) {
		options = {};
	}

	let cacheKey = 'costMatrix:' + roomName;
	let matrix = hivemind.segmentMemory.isReady() ? cache.inHeap(
		cacheKey,
		500,
		() => {
			const roomIntel = getRoomIntel(roomName);
			return roomIntel.getCostMatrix();
		},
	) : new PathFinder.CostMatrix();

	if (matrix && options.singleRoom && hivemind.segmentMemory.isReady()) {
		// Highly discourage room exits if creep is supposed to stay in a room.
		cacheKey += ':singleRoom';

		matrix = cache.inHeap(
			cacheKey,
			500,
			() => generateSingleRoomCostMatrix(matrix, roomName),
		);
	}

	if (matrix && hivemind.segmentMemory.isReady() && Game.rooms[roomName] && Game.rooms[roomName].isMine() && Game.rooms[roomName].defense.getEnemyStrength() > 0 && !options.ignoreMilitary) {
		// Discourage unprotected areas when enemies are in the room.
		cacheKey += ':inCombat';

		matrix = cache.inHeap(
			cacheKey,
			20,
			() => generateCombatCostMatrix(matrix, roomName),
		);
	}

	return matrix;
}

/**
 * Generates a derivative cost matrix that highly discourages room exits.
 *
 * @param {PathFinder.CostMatrix} matrix
 *   The matrix to use as a base.
 * @param {string} roomName
 *   Name of the room this matrix represents.
 *
 * @return {PathFinder.CostMatrix}
 *   The modified cost matrix.
 */
function generateSingleRoomCostMatrix(matrix, roomName) {
	const newMatrix = matrix.clone();
	const terrain = new Room.Terrain(roomName);
	for (let i = 1; i < 49; i++) {
		if (terrain.get(i, 0) !== TERRAIN_MASK_WALL) newMatrix.set(i, 0, 50);
		if (terrain.get(0, i) !== TERRAIN_MASK_WALL) newMatrix.set(0, i, 50);
		if (terrain.get(i, 49) !== TERRAIN_MASK_WALL) newMatrix.set(i, 49, 50);
		if (terrain.get(49, i) !== TERRAIN_MASK_WALL) newMatrix.set(49, i, 50);
	}

	return newMatrix;
}

/**
 * Generates a derivative cost matrix that discourages unprotected areas.
 *
 * @param {PathFinder.CostMatrix} matrix
 *   The matrix to use as a base.
 * @param {string} roomName
 *   Name of the room this matrix represents.
 *
 * @return {PathFinder.CostMatrix}
 *   The modified cost matrix.
 */
function generateCombatCostMatrix(matrix, roomName) {
	const newMatrix = matrix.clone();
	const terrain = new Room.Terrain(roomName);

	// We flood fill from enemies and make all tiles they can reach more
	// difficult to travel through.
	const closedList: {[location: string]: boolean} = {};
	const openList: RoomPosition[] = [];

	for (const username in Game.rooms[roomName].enemyCreeps) {
		if (hivemind.relations.isAlly(username)) continue;
		for (const creep of Game.rooms[roomName].enemyCreeps[username]) {
			const location = encodePosition(creep.pos);
			closedList[location] = true;
			openList.push(creep.pos);
		}
	}

	while (openList.length > 0) {
		const pos = openList.pop();

		// Increase cost matrix value for the given tile.
		let value = matrix.get(pos.x, pos.y);
		if (value === 0) {
			value = 1;
			if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_SWAMP) value = 5;
		}

		newMatrix.set(pos.x, pos.y, value + 10);

		// Add available adjacent tiles.
		handleMapArea(pos.x, pos.y, (x, y) => {
			if (matrix.get(x, y) > 100) return;
			if (terrain.get(x, y) === TERRAIN_MASK_WALL) return;

			const newPos = new RoomPosition(x, y, roomName);
			const newLocation = encodePosition(newPos);
			if (closedList[newLocation]) return;
			if (Game.rooms[roomName].roomPlanner.isPlannedLocation(newPos, 'rampart')) return;

			closedList[newLocation] = true;
			openList.push(newPos);
		});
	}

	return newMatrix;
}

/**
 * Runs code for all given obstacles and roads.
 *
 * @param {String} roomName
 *   Name of the room that's being handled.
 * @param {object} structures
 *   Arrays of structures to navigate around, keyed by structure type.
 * @param {object} constructionSites
 *   Arrays of construction sites to navigate around, keyed by structure type.
 * @param {Function} roadCallback
 *   Gets called for every road found in structures.
 * @param {Function} blockerCallback
 *   Gets called for every obstacle found in structures or constructionSites.
 * @param {Function} sourceKeeperCallback
 *   Gets called for every position in range of a source keeper.
 */
function markBuildings(roomName, structures, constructionSites, roadCallback, blockerCallback, sourceKeeperCallback) {
	_.each(OBSTACLE_OBJECT_TYPES, structureType => {
		_.each(structures[structureType], structure => {
			// Can't walk through non-walkable buildings.
			blockerCallback(structure);
		});

		_.each(constructionSites[structureType], site => {
			// Can't walk through non-walkable construction sites.
			blockerCallback(site);
		});
	});

	_.each(structures[STRUCTURE_PORTAL], structure => {
		// Treat portals as blocking. They will be targetted intentionally.
		blockerCallback(structure);
	});

	_.each(structures[STRUCTURE_RAMPART], structure => {
		if (!structure.my) {
			// Enemy ramparts are blocking.
			blockerCallback(structure);
		}
	});

	if (hivemind.segmentMemory.isReady()) {
		// If we're running a (successful) exploit in this room, tiles
		// should not be marked inaccessible.
		const roomIntel = getRoomIntel(roomName);
		// @todo Make sure Game.exploits is set at this point and use that instead.
		if (_.size(structures[STRUCTURE_KEEPER_LAIR]) > 0 && !Memory.exploits?.[roomName]) {
			// Add area around keeper lairs as obstacles.
			_.each(structures[STRUCTURE_KEEPER_LAIR], structure => {
				handleMapArea(structure.pos.x, structure.pos.y, (x, y) => {
					sourceKeeperCallback(x, y);
				}, 3);
			});

			// Add area around sources as obstacles.
			_.each(roomIntel.getSourcePositions(), sourceInfo => {
				handleMapArea(sourceInfo.x, sourceInfo.y, (x, y) => {
					sourceKeeperCallback(x, y);
				}, 4);
			});

			// Add area around mineral as obstacles.
			const mineralInfo = roomIntel.getMineralPosition();
			if (mineralInfo) {
				handleMapArea(mineralInfo.x, mineralInfo.y, (x, y) => {
					sourceKeeperCallback(x, y);
				}, 4);
			}
		}

		// For exit consistency, we need to check corresponding exit
		// tiles of adjacend rooms, and if blocked by source keepers, block tiles
		// in our own room as well.
		const exits = roomIntel.getExits();
		for (const dir of [TOP, BOTTOM, LEFT, RIGHT]) {
			if (!exits[dir]) continue;

			const otherRoomName = exits[dir];
			const otherRoomIntel = getRoomIntel(otherRoomName);
			if (!otherRoomIntel || !otherRoomIntel.hasCostMatrixData()) continue;

			const matrix = getCostMatrix(otherRoomName);
			if (dir === TOP || dir === BOTTOM) {
				const y = (dir === TOP ? 0 : 49);
				for (let x = 1; x < 49; x++) {
					if (matrix.get(x, 49 - y) > 100) sourceKeeperCallback(x, y);
				}

				continue;
			}

			const x = (dir === LEFT ? 0 : 49);
			for (let y = 1; y < 49; y++) {
				if (matrix.get(49 - x, y) > 100) sourceKeeperCallback(x, y);
			}
		}
	}

	_.each(structures[STRUCTURE_ROAD], structure => {
		// Favor roads over plain tiles.
		roadCallback(structure);
	});
}

export {
	getCostMatrix,
	markBuildings,
};
