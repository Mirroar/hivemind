import cache from 'utils/cache';
import hivemind from 'hivemind';
import {encodePosition} from 'utils/serialization';
import {ENEMY_STRENGTH_NONE} from 'room-defense';
import {getRoomIntel} from 'room-intel';
import {handleMapArea} from 'utils/map';

interface CostMatrixOptions {
	singleRoom?: boolean;
	isQuad?: boolean;
	ignoreMilitary?: boolean;
	allowDanger?: boolean;
}

declare global {
	namespace NodeJS {
		interface Global {
			getCostMatrix: typeof getCostMatrix;
			getDangerMatrix: typeof getDangerMatrix;
		}
	}
}

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
function getCostMatrix(roomName: string, options?: CostMatrixOptions): CostMatrix {
	if (!options) {
		options = {};
	}

	const cacheDuration = hivemind.segmentMemory.isReady() ? (roomHasBlockingConstructionSites(roomName) ? 20 : 500) : 1;

	let cacheKey = 'costMatrix:' + roomName;
	if (options.allowDanger) {
		cacheKey += ':danger';
	}
	let matrix = hivemind.segmentMemory.isReady() ? cache.inHeap(
		cacheKey,
		cacheDuration,
		() => {
			const roomIntel = getRoomIntel(roomName);
			return roomIntel.getBaseCostMatrix(options.allowDanger);
		},
	) : new PathFinder.CostMatrix();

	if (options.singleRoom && hivemind.segmentMemory.isReady()) {
		// Highly discourage room exits if creep is supposed to stay in a room.
		cacheKey += ':singleRoom';

		matrix = cache.inHeap(
			cacheKey,
			cacheDuration,
			() => generateSingleRoomCostMatrix(matrix, roomName),
		);
	}

	if (options.isQuad) {
		cacheKey += ':quad';

		matrix = cache.inHeap(
			cacheKey,
			cacheDuration,
			() => generateQuadCostMatrix(matrix, roomName),
		);
	}

	if (
		!options.ignoreMilitary
		&& !options.allowDanger
		&& hivemind.segmentMemory.isReady()
		&& Game.rooms[roomName]
		&& Game.rooms[roomName].isMine()
		&& Game.rooms[roomName].defense.getEnemyStrength() > ENEMY_STRENGTH_NONE
	) {
		// Discourage unprotected areas when enemies are in the room.
		cacheKey += ':inCombat';

		matrix = cache.inHeap(
			cacheKey,
			20,
			() => generateCombatCostMatrix(matrix, roomName, options.singleRoom),
		);
	}
	else {
		cache.inHeap('dangerMatrix:' + roomName, 20, () => new PathFinder.CostMatrix());
	}

	if (!options.allowDanger && !options.ignoreMilitary) {
		// Avoid source keepers directly, no need to cache.
		matrix = matrix.clone();
		for (const creep of Game.rooms[roomName]?.enemyCreeps?.['Source Keeper'] || []) {
			handleMapArea(creep.pos.x, creep.pos.y, (x, y) => {
				matrix.set(x, y, 255);
			}, 3);
		}
	}

	return matrix;
}

function roomHasBlockingConstructionSites(roomName: string): boolean {
	return cache.inHeap('roomHasBlockingConstructionSites:' + roomName, 20, () => (Game.rooms[roomName]?.find(
		FIND_MY_CONSTRUCTION_SITES,
		{filter: site => !site.isWalkable()},
	) || []).length > 0);
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
function generateSingleRoomCostMatrix(matrix: CostMatrix, roomName: string): CostMatrix {
	const newMatrix = matrix.clone();
	const terrain = new Room.Terrain(roomName);
	for (let i = 1; i < 49; i++) {
		if (terrain.get(i, 0) !== TERRAIN_MASK_WALL) newMatrix.set(i, 0, 150);
		if (terrain.get(0, i) !== TERRAIN_MASK_WALL) newMatrix.set(0, i, 150);
		if (terrain.get(i, 49) !== TERRAIN_MASK_WALL) newMatrix.set(i, 49, 150);
		if (terrain.get(49, i) !== TERRAIN_MASK_WALL) newMatrix.set(49, i, 150);
	}

	return newMatrix;
}

/**
 * Generates a derivative cost matrix for navigating quads.
 *
 * @param {PathFinder.CostMatrix} matrix
 *   The matrix to use as a base.
 * @param {string} roomName
 *   Name of the room this matrix represents.
 *
 * @return {PathFinder.CostMatrix}
 *   The modified cost matrix.
 */
function generateQuadCostMatrix(matrix: CostMatrix, roomName: string): CostMatrix {
	const newMatrix = matrix.clone();
	const terrain = new Room.Terrain(roomName);

	for (let x = 1; x < 49; x++) {
		for (let y = 1; y < 49; y++) {
			if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

			let max = Math.max(matrix.get(x, y), matrix.get(x + 1, y), matrix.get(x, y + 1), matrix.get(x + 1, y + 1));
			if (max < 255 && (
				terrain.get(x + 1, y) === TERRAIN_MASK_WALL
				|| terrain.get(x, y + 1) === TERRAIN_MASK_WALL
				|| terrain.get(x + 1, y + 1) === TERRAIN_MASK_WALL
			)) {
				max = 255;
			}
			else if (max < 5 && (
				terrain.get(x + 1, y) === TERRAIN_MASK_SWAMP
				|| terrain.get(x, y + 1) === TERRAIN_MASK_SWAMP
				|| terrain.get(x + 1, y + 1) === TERRAIN_MASK_SWAMP
			)) {
				max = 5;
			}

			newMatrix.set(x, y, max);
		}
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
function generateCombatCostMatrix(matrix: CostMatrix, roomName: string, blockDangerousTiles: boolean): CostMatrix {
	const newMatrix = matrix.clone();
	const dangerMatrix = new PathFinder.CostMatrix();

	// No need to consider enemies when the room is safemoded.
	if (Game.rooms[roomName].controller.safeMode) {
		cache.inHeap('dangerMatrix:' + roomName, 20, () => dangerMatrix);
		return newMatrix;
	}

	// We flood fill from enemies and make all tiles they can reach more
	// difficult to travel through.
	const closedList: Record<string, boolean> = {};
	const openList: RoomPosition[] = [];

	for (const username in Game.rooms[roomName].enemyCreeps) {
		if (hivemind.relations.isAlly(username)) continue;
		for (const creep of Game.rooms[roomName].enemyCreeps[username]) {
			// Ignore creeps inside our walls. If they're here already, we don't
			// want all our creeps to stop moving because the inside of the
			// base is suddenly dangerous.
			if (Game.rooms[roomName].roomPlanner.isPlannedLocation(creep.pos, 'safe')) continue;

			const location = encodePosition(creep.pos);
			closedList[location] = true;
			openList.push(creep.pos);
		}
	}

	while (openList.length > 0) {
		const pos = openList.pop();
		if (Game.rooms[roomName].roomPlanner.isPlannedLocation(pos, 'safe')) continue;

		updateNewMatrices(matrix, newMatrix, dangerMatrix, pos, blockDangerousTiles);
		handleAdjacentTiles(pos, openList, closedList);
	}

	cache.inHeap('dangerMatrix:' + roomName, 20, () => dangerMatrix);

	return newMatrix;
}

function updateNewMatrices(
	matrix: CostMatrix,
	newMatrix: CostMatrix,
	dangerMatrix: CostMatrix,
	pos: RoomPosition,
	blockDangerousTiles: boolean,
) {
	const roomName = pos.roomName;
	const terrain = new Room.Terrain(roomName);

	// Increase cost matrix value for the given tile.
	let value = matrix.get(pos.x, pos.y);
	if (value === 0) {
		value = 2;
		if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_SWAMP) value = 5;
	}

	newMatrix.set(pos.x, pos.y, blockDangerousTiles ? 255 : (5 * value) + 25);
	dangerMatrix.set(pos.x, pos.y, 1);
	handleMapArea(pos.x, pos.y, (x, y) => {
		// @todo No need to consider tiles at 3 range dangerous if there's
		// no ranged creeps.
		if (dangerMatrix.get(x, y) > 0) return;

		const newPos = new RoomPosition(x, y, roomName);
		if (terrain.get(x, y) === TERRAIN_MASK_WALL && !Game.rooms[roomName].roomPlanner.isPlannedLocation(newPos, 'road')) return;
		if (Game.rooms[roomName].roomPlanner.isPlannedLocation(newPos, 'rampart')) return;
		if (Game.rooms[roomName].roomPlanner.isPlannedLocation(newPos, 'safe')) return;
		dangerMatrix.set(x, y, 2);
		if (Game.rooms[roomName].roomPlanner.isPlannedLocation(newPos, 'wall')) return;

		let value = matrix.get(x, y);
		if (value === 0) {
			value = 2;
			if (terrain.get(x, y) === TERRAIN_MASK_SWAMP) value = 5;
		}

		newMatrix.set(x, y, blockDangerousTiles ? 255 : (5 * value) + 25);
	}, 3);
}

function handleAdjacentTiles(pos: RoomPosition, openList: RoomPosition[], closedList: Record<string, boolean>) {
	const roomName = pos.roomName;
	const terrain = new Room.Terrain(roomName);

	// Add available adjacent tiles.
	handleMapArea(pos.x, pos.y, (x, y) => {
		if (x === pos.x && y === pos.y) return;

		const newPos = new RoomPosition(x, y, roomName);
		if (terrain.get(x, y) === TERRAIN_MASK_WALL && !Game.rooms[roomName].roomPlanner.isPlannedLocation(newPos, 'road')) return;

		const newLocation = encodePosition(newPos);
		if (closedList[newLocation]) return;
		if (Game.rooms[roomName].roomPlanner.isPlannedLocation(newPos, 'rampart')) return;
		if (Game.rooms[roomName].roomPlanner.isPlannedLocation(newPos, 'wall')) return;

		closedList[newLocation] = true;
		openList.push(newPos);
	});
}

function getDangerMatrix(roomName: string): CostMatrix {
	if (!Game.rooms[roomName]?.isMine()) return new PathFinder.CostMatrix();
	if (Game.rooms[roomName].defense.getEnemyStrength() === ENEMY_STRENGTH_NONE) return new PathFinder.CostMatrix();

	getCostMatrix(roomName);

	return cache.fromHeap('dangerMatrix:' + roomName, true) || new PathFinder.CostMatrix();
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
function markBuildings(
	roomName: string,
	structures: Record<string, Structure[]>,
	constructionSites: Record<string, ConstructionSite[]>,
	roadCallback: (structure: Structure) => void,
	blockerCallback: (structure: Structure | ConstructionSite) => void,
	sourceKeeperCallback: (x: number, y: number) => void,
) {
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

	_.each(structures[STRUCTURE_RAMPART], (structure: StructureRampart) => {
		if (!structure.my) {
			// Enemy ramparts are blocking.
			blockerCallback(structure);
		}
	});

	if (hivemind.segmentMemory.isReady()) {
		// If we're running a (successful) exploit in this room, tiles
		// should not be marked inaccessible.
		const roomIntel = getRoomIntel(roomName);
		if (_.size(structures[STRUCTURE_KEEPER_LAIR]) > 0) {
			if (!(Memory.strategy?.remoteHarvesting?.rooms || []).includes(roomName)) {
				// Add area around sources as obstacles.
				_.each(roomIntel.getSourcePositions(), sourceInfo => {
					handleMapArea(sourceInfo.x, sourceInfo.y, (x, y) => {
						sourceKeeperCallback(x, y);
					}, 4);

					// Add area around keeper lairs as obstacles.
					_.each(structures[STRUCTURE_KEEPER_LAIR], structure => {
						if (structure.pos.getRangeTo(sourceInfo.x, sourceInfo.y) > 7) return;

						handleMapArea(structure.pos.x, structure.pos.y, (x, y) => {
							sourceKeeperCallback(x, y);
						}, 3);
					});
				});
			}
		}

		// For exit consistency, we need to check corresponding exit
		// tiles of adjacend rooms, and if blocked by source keepers, block tiles
		// in our own room as well.
		const exits = roomIntel.getExits();
		for (const dir of [TOP, BOTTOM, LEFT, RIGHT]) {
			if (!exits[dir]) continue;

			markSourceKeeperExits(exits[dir], dir, sourceKeeperCallback);
		}
	}

	_.each(structures[STRUCTURE_ROAD], structure => {
		// Favor roads over plain tiles.
		roadCallback(structure);
	});
}

function markSourceKeeperExits(roomName: string, dir: TOP | LEFT | BOTTOM | RIGHT, sourceKeeperCallback: (x: number, y: number) => void) {
	if ((Memory.strategy?.remoteHarvesting?.rooms || []).includes(roomName)) return;

	const otherRoomIntel = getRoomIntel(roomName);
	if (!otherRoomIntel || !otherRoomIntel.hasCostMatrixData()) return;
	if (_.size(otherRoomIntel.getStructures(STRUCTURE_KEEPER_LAIR)) === 0) return;

	// @todo Instead of reading cost matrix values, check distance to
	// keeper lairs and sources.
	// @todo This kind of depends on whether we allow traversing dangerous
	// rooms or not.
	const matrix = getCostMatrix(roomName);
	if (dir === TOP || dir === BOTTOM) {
		const y = (dir === TOP ? 0 : 49);
		for (let x = 1; x < 49; x++) {
			if (matrix.get(x, 49 - y) > 100) sourceKeeperCallback(x, y);
		}

		return;
	}

	const x = (dir === LEFT ? 0 : 49);
	for (let y = 1; y < 49; y++) {
		if (matrix.get(49 - x, y) > 100) sourceKeeperCallback(x, y);
	}
}

export {
	getCostMatrix,
	getDangerMatrix,
	markBuildings,
};

global.getCostMatrix = getCostMatrix;
global.getDangerMatrix = getDangerMatrix;
