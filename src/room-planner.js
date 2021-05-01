'use strict';

/* global hivemind PathFinder Room RoomPosition RoomVisual
CONTROLLER_STRUCTURES TERRAIN_MASK_WALL FIND_SOURCES FIND_MINERALS */

const utilities = require('./utilities');

const MAX_ROOM_LEVEL = 8;

/**
 * Creates a room layout and makes sure the room is built accordingly.
 * @constructor
 *
 * @param {string} roomName
 *   Name of the room this room planner is assigned to.
 */
const RoomPlanner = function (roomName) {
	this.roomPlannerVersion = 31;
	this.roomName = roomName;
	this.room = Game.rooms[roomName]; // Will not always be available.

	if (!Memory.rooms[roomName]) {
		Memory.rooms[roomName] = {};
	}

	if (!Memory.rooms[roomName].roomPlanner) {
		Memory.rooms[roomName].roomPlanner = {};
	}

	this.memory = Memory.rooms[roomName].roomPlanner;

	if ((this.memory.drawDebug || 0) > 0) {
		this.memory.drawDebug--;
		this.drawDebug();
	}
};

/**
 * Draws a simple representation of the room layout using RoomVisuals.
 */
RoomPlanner.prototype.drawDebug = function () {
	const debugSymbols = {
		container: '⊔',
		exit: '🚪',
		extension: '⚬',
		lab: '🔬',
		link: '🔗',
		nuker: '☢',
		observer: '👁',
		powerSpawn: '⚡',
		road: '·',
		spawn: '⭕',
		storage: '⬓',
		terminal: '⛋',
		tower: '⚔',
		wall: '▦',
	};

	const visual = new RoomVisual(this.roomName);

	if (this.memory.locations) {
		for (const locationType in this.memory.locations) {
			if (!debugSymbols[locationType]) continue;

			const positions = this.memory.locations[locationType];
			for (const posName of _.keys(positions)) {
				const pos = utilities.decodePosition(posName);

				visual.text(debugSymbols[locationType], pos.x, pos.y + 0.2);
			}
		}

		for (const posName of _.keys(this.memory.locations.rampart || [])) {
			const pos = utilities.decodePosition(posName);

			visual.rect(pos.x - 0.5, pos.y - 0.5, 1, 1, {fill: '#0f0', opacity: 0.2});
		}
	}
};

/**
 * Allows this room planner to give commands in controlled rooms.
 */
RoomPlanner.prototype.runLogic = function () {
	if (Game.cpu.bucket < 3500) return;

	// Recalculate room layout if using a new version.
	if (!this.memory.plannerVersion || this.memory.plannerVersion !== this.roomPlannerVersion) {
		delete this.memory.locations;
		delete this.memory.planningTries;
		this.memory.plannerVersion = this.roomPlannerVersion;
	}

	// Sometimes room planning can't be finished successfully. Try a maximum of 10
	// times in that case.
	if (!this.memory.planningTries) this.memory.planningTries = 0;
	if (!this.isPlanningFinished()) {
		if (Game.cpu.getUsed() < Game.cpu.tickLimit / 2) {
			this.placeFlags();
			this.memory.planningTries++;
		}

		return;
	}

	if (this.memory.lastRun && Game.time - this.memory.lastRun < 100 * hivemind.getThrottleMultiplier()) return;

	this.memory.lastRun = Game.time;

	// Prune old planning cost matrixes. They will be regenerated if needed.
	delete this.memory.wallDistanceMatrix;
	delete this.memory.exitDistanceMatrix;

	this.checkAdjacentRooms();
};

/**
 * Plans a room planner location of a certain type.
 *
 * @param {RoomPosition} pos
 *   Position to plan the structure at.
 * @param {string} locationType
 *   Type of location to plan.
 * @param {number} pathFindingCost
 *   Value to set in the pathfinding costmatrix at this position (Default 255).
 */
RoomPlanner.prototype.placeFlag = function (pos, locationType, pathFindingCost) {
	const posName = utilities.encodePosition(pos);

	if (!this.memory.locations) {
		this.memory.locations = {};
	}

	if (!this.memory.locations[locationType]) {
		this.memory.locations[locationType] = {};
	}

	this.memory.locations[locationType][posName] = 1;

	if (typeof pathFindingCost === 'undefined') {
		pathFindingCost = 255;
	}

	if (pathFindingCost && this.buildingMatrix.get(pos.x, pos.y) < 100) {
		this.buildingMatrix.set(pos.x, pos.y, pathFindingCost);
	}
};

/**
 * Generates CostMatrixes needed for structure placement.
 */
RoomPlanner.prototype.generateDistanceMatrixes = function () {
	const wallMatrix = new PathFinder.CostMatrix();
	const exitMatrix = new PathFinder.CostMatrix();

	this.prepareDistanceMatrixes(wallMatrix, exitMatrix);

	// @todo Use some kind of flood fill to calculate these faster.
	let currentDistance = 1;
	let done = false;
	while (!done) {
		done = true;

		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				done &= !this.markDistanceTiles(wallMatrix, currentDistance, x, y);
				done &= !this.markDistanceTiles(exitMatrix, currentDistance, x, y);
			}
		}

		currentDistance++;
	}

	this.memory.wallDistanceMatrix = wallMatrix.serialize();
	this.memory.exitDistanceMatrix = exitMatrix.serialize();
};

/**
 * Initializes wall and exit distance matrix with walls and adjacent tiles.
 *
 * @param {PathFinder.CostMatrix} wallMatrix
 *   Matrix that will have a 1 next to every wall tile.
 * @param {PathFinder.CostMatrix} exitMatrix
 *   Matrix that will have a 1 at every exit tile.
 */
RoomPlanner.prototype.prepareDistanceMatrixes = function (wallMatrix, exitMatrix) {
	for (let x = 0; x < 50; x++) {
		for (let y = 0; y < 50; y++) {
			if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) {
				wallMatrix.set(x, y, 255);
				exitMatrix.set(x, y, 255);
				continue;
			}

			if (x === 0 || x === 49 || y === 0 || y === 49) {
				exitMatrix.set(x, y, 1);
			}

			this.markWallAdjacentTiles(wallMatrix, x, y);
		}
	}
};

/**
 * Sets a tile's value to 1 if it is next to a wall.
 *
 * @param {PathFinder.CostMatrix} matrix
 *   The matrix to modify.
 * @param {number} x
 *   x position of the tile in question.
 * @param {number} y
 *   y position of the tile in question.
 */
RoomPlanner.prototype.markWallAdjacentTiles = function (matrix, x, y) {
	utilities.handleMapArea(x, y, (ax, ay) => {
		if (this.terrain.get(ax, ay) === TERRAIN_MASK_WALL) {
			matrix.set(x, y, 1);
			return false;
		}
	});
};

/**
 * Sets a tile's value if it is 0 and has a tile value of distance adjacent.
 *
 * @param {PathFinder.CostMatrix} matrix
 *   The matrix to modify.
 * @param {number} distance
 *   Distance value to look for in adjacent tiles.
 * @param {number} x
 *   x position of the tile in question.
 * @param {number} y
 *   y position of the tile in question.
 *
 * @return {boolean}
 *   True if tile value was modified.
 */
RoomPlanner.prototype.markDistanceTiles = function (matrix, distance, x, y) {
	if (matrix.get(x, y) !== 0) return false;

	let modified = false;
	utilities.handleMapArea(x, y, (ax, ay) => {
		if (matrix.get(ax, ay) === distance) {
			matrix.set(x, y, distance + 1);
			modified = true;
			return false;
		}
	});

	return modified;
};

/**
 * Find positions from where many exit tiles are in short range.
 *
 * @return {object}
 *   An object keyed by exit direction containing objects with the following
 *   keys:
 *   - count: 0 in preparation for storing actual tower number. @todo remove
 *   - tiles: A list of potential tower positions.
 */
RoomPlanner.prototype.findTowerPositions = function () {
	const positions = {
		N: {count: 0, tiles: []},
		E: {count: 0, tiles: []},
		S: {count: 0, tiles: []},
		W: {count: 0, tiles: []},
	};

	const allDirectionsSafe = _.sum(this.memory.adjacentSafe) === 4;
	for (let x = 1; x < 49; x++) {
		for (let y = 1; y < 49; y++) {
			if (this.buildingMatrix.get(x, y) !== 0 && this.buildingMatrix.get(x, y) !== 10) continue;
			if (this.safetyMatrix.get(x, y) !== 1) continue;
			if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
			let score = 0;

			let tileDir;
			if (x > y) {
				// Northeast.
				if (49 - x > y) tileDir = 'N';
				else tileDir = 'E';
			}
			// Southwest.
			else if (49 - x > y) tileDir = 'W';
			else tileDir = 'S';

			// No need to check in directions where there is no exit.
			if (this.exitTiles[tileDir].length === 0) continue;

			// Don't count exits toward "safe" rooms or dead ends.
			if (!allDirectionsSafe && this.memory.adjacentSafe && this.memory.adjacentSafe[tileDir]) continue;

			for (const dir in this.exitTiles) {
				// Don't score distance to exits toward "safe" rooms or dead ends.
				// Unless all directions are safe.
				if (!allDirectionsSafe && this.memory.adjacentSafe && this.memory.adjacentSafe[dir]) continue;

				for (const pos of this.exitTiles[dir]) {
					score += 1 / pos.getRangeTo(x, y);
				}
			}

			positions[tileDir].tiles.push({
				score,
				pos: new RoomPosition(x, y, this.roomName),
			});
		}
	}

	return positions;
};

/**
 * Makes plans for a room and place flags to visualize.
 */
RoomPlanner.prototype.placeFlags = function () {
	// @todo Place some ramparts on spawns and maybe towers as a last protection
	// if walls go down.
	// @todo Build small ramparts on spawns and on paths close to exit
	// where enemy ranged creeps might reach.
	const start = Game.cpu.getUsed();
	this.terrain = new Room.Terrain(this.roomName);

	if (!this.memory.wallDistanceMatrix) {
		this.generateDistanceMatrixes();
		return;
	}

	// Reset location memory, to be replaced with new flags.
	this.memory.locations = {};
	this.wallDistanceMatrix = PathFinder.CostMatrix.deserialize(this.memory.wallDistanceMatrix);
	this.exitDistanceMatrix = PathFinder.CostMatrix.deserialize(this.memory.exitDistanceMatrix);

	// Prepare CostMatrix and exit points.
	this.exitTiles = {
		N: [],
		S: [],
		W: [],
		E: [],
	};
	const potentialWallPositions = [];
	const potentialCenterPositions = [];
	this.roads = [];
	this.prepareBuildingMatrix(potentialWallPositions, potentialCenterPositions);

	// Decide where exit regions are and where walls should be placed.
	const exitCenters = this.findExitCenters();

	// Decide where room center should be by averaging exit positions.
	let cx = 0;
	let cy = 0;
	let count = 0;
	for (const dir of _.keys(exitCenters)) {
		for (const pos of exitCenters[dir]) {
			count++;
			cx += pos.x;
			cy += pos.y;
		}
	}

	cx = Math.floor(cx / count);
	cy = Math.floor(cy / count);

	// Find closest position with distance from walls around there.
	const roomCenter = (new RoomPosition(cx, cy, this.roomName)).findClosestByRange(potentialCenterPositions);
	this.roomCenter = roomCenter;
	this.placeFlag(roomCenter, 'center', null);

	// Do another flood fill pass from interesting positions to remove walls that don't protect anything.
	this.pruneWalls(potentialWallPositions);

	// Actually place ramparts.
	for (const i in potentialWallPositions) {
		if (potentialWallPositions[i].isRelevant) {
			this.placeFlag(potentialWallPositions[i], 'rampart', null);
		}
	}

	// Center is accessible via the 4 cardinal directions.
	this.roomCenterEntrances = [
		new RoomPosition(roomCenter.x + 2, roomCenter.y, this.roomName),
		new RoomPosition(roomCenter.x - 2, roomCenter.y, this.roomName),
		new RoomPosition(roomCenter.x, roomCenter.y + 2, this.roomName),
		new RoomPosition(roomCenter.x, roomCenter.y - 2, this.roomName),
	];

	// Find paths from each exit towards the room center for making roads.
	for (const dir of _.keys(exitCenters)) {
		for (const pos of exitCenters[dir]) {
			this.scanAndAddRoad(pos, this.roomCenterEntrances);
		}
	}

	if (this.room) {
		// @todo Have intelManager save locations (not just IDs) of minerals, so we don't need room access here.
		// @todo Use source and controller positions from room intel.
		// We also save which road belongs to which path, so we can selectively autobuild roads during room bootstrap instead of building all roads at once.
		if (this.room.controller) {
			const controllerRoads = this.scanAndAddRoad(this.room.controller.pos, this.roomCenterEntrances);
			for (const i in controllerRoads) {
				if (i === 0) continue;
				this.placeFlag(controllerRoads[i], 'road.controller', null);
			}

			this.placeContainer(controllerRoads, 'controller');

			// Place a link near controller, but off the calculated path.
			this.placeLink(controllerRoads, 'controller');
		}

		if (this.room.mineral) {
			this.placeFlag(this.room.mineral.pos, 'extractor');
			const mineralRoads = this.scanAndAddRoad(this.room.mineral.pos, this.roomCenterEntrances);
			for (const pos of mineralRoads) {
				this.placeFlag(pos, 'road.mineral', null);
			}

			this.placeContainer(mineralRoads, 'mineral');

			// Make sure no other paths get led through harvester position.
			this.buildingMatrix.set(mineralRoads[0].x, mineralRoads[0].y, 255);
		}

		if (this.room.sources) {
			this.memory.sources = {};
			for (const source of this.room.sources) {
				// Find adjacent space that will provide most building space.
				let bestPos;
				utilities.handleMapArea(source.pos.x, source.pos.y, (x, y) => {
					if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;

					let numFreeTiles = 0;
					utilities.handleMapArea(x, y, (x2, y2) => {
						if (this.terrain.get(x2, y2) === TERRAIN_MASK_WALL) return;

						numFreeTiles++;
					});

					if (!bestPos || bestPos.numFreeTiles < numFreeTiles) {
						bestPos = {x, y, numFreeTiles};
					}
				});

				const harvestPosition = new RoomPosition(bestPos.x, bestPos.y, this.roomName);
				this.placeFlag(harvestPosition, 'harvester', null);
				this.placeFlag(harvestPosition, 'bay_center', null);

				// Discourage roads through spots around harvest position.
				utilities.handleMapArea(harvestPosition.x, harvestPosition.y, (x, y) => {
					if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;

					if (this.buildingMatrix.get(x, y) < 10 && this.buildingMatrix.get(x, y) !== 1) this.buildingMatrix.set(x, y, 10);
				});

				const sourceRoads = this.scanAndAddRoad(harvestPosition, this.roomCenterEntrances);
				for (const pos of sourceRoads) {
					this.placeFlag(pos, 'road.source', null);
				}

				this.placeFlag(harvestPosition, 'container.source', null);
				this.placeFlag(harvestPosition, 'container', null);

				// Setup memory for quick access to harvest spots.
				this.memory.sources[source.id] = {
					harvestPos: utilities.serializePosition(harvestPosition, this.roomName),
				};

				// Make sure no other paths get led through harvester position.
				this.buildingMatrix.set(harvestPosition.x, harvestPosition.y, 255);

				utilities.handleMapArea(harvestPosition.x, harvestPosition.y, (x, y) => {
					if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;
					if (!this.isBuildableTile(x, y)) return;
					if (x === harvestPosition.x && y === harvestPosition.y) return;

					// Only place spawn where a road tile is adjacent, so creeps can
					// actually exit when a harvester is on its spot.
					let spawnPlaced = false;
					utilities.handleMapArea(x, y, (x2, y2) => {
						if (this.buildingMatrix.get(x2, y2) !== 1) return;

						this.placeFlag(new RoomPosition(x, y, this.roomName), 'spawn');
						spawnPlaced = true;
						return false;
					});

					if (spawnPlaced) return false;
				});

				let linkPlaced = false;
				utilities.handleMapArea(harvestPosition.x, harvestPosition.y, (x, y) => {
					if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;
					if (!this.isBuildableTile(x, y)) return;
					if (x === harvestPosition.x && y === harvestPosition.y) return;

					if (linkPlaced) {
						this.placeFlag(new RoomPosition(x, y, this.roomName), 'extension');
						this.placeFlag(new RoomPosition(x, y, this.roomName), 'extension.harvester');
					}
					else {
						this.placeFlag(new RoomPosition(x, y, this.roomName), 'link');
						this.placeFlag(new RoomPosition(x, y, this.roomName), 'link.source');
						linkPlaced = true;
					}
				});
			}
		}
	}

	for (const pos of this.roads) {
		this.placeFlag(pos, 'road', 1);
	}

	this.placeRoomCore();

	this.startBuildingPlacement();
	this.placeAll('spawn', true);
	this.placeHelperParkingLot();
	this.placeBays();
	this.placeLabs();
	this.placeAll('powerSpawn', true);
	this.placeAll('nuker', true);
	this.placeAll('observer', false);
	this.placeTowers();
	this.placeSpawnWalls();

	const end = Game.cpu.getUsed();
	console.log('Planning for', this.roomName, 'took', end - start, 'CPU');

	// Reset harvest position info for harvesters in case they are not correctly
	// assigned any more.
	if (this.room) {
		_.each(this.room.creepsByRole.harvester, creep => {
			delete creep.memory.harvestPos;
			delete creep.memory.noHarvestPos;
		});
	}
};

/**
 * Prepares building cost matrix.
 *
 * @param {RoomPosition[]} potentialWallPositions
 *   List of potential wall positions for this room to add to.
 * @param {RoomPosition[]} potentialCenterPositions
 *   List of potential room core positions to add to.
 */
RoomPlanner.prototype.prepareBuildingMatrix = function (potentialWallPositions, potentialCenterPositions) {
	this.buildingMatrix = new PathFinder.CostMatrix();
	for (let x = 0; x < 50; x++) {
		for (let y = 0; y < 50; y++) {
			if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) {
				this.buildingMatrix.set(x, y, 255);
				continue;
			}

			// Register room exit tiles.
			if (x === 0) this.exitTiles.W.push(new RoomPosition(x, y, this.roomName));
			if (x === 49) this.exitTiles.E.push(new RoomPosition(x, y, this.roomName));
			if (y === 0) this.exitTiles.N.push(new RoomPosition(x, y, this.roomName));
			if (y === 49) this.exitTiles.S.push(new RoomPosition(x, y, this.roomName));

			// Treat border as unwalkable for in-room pathfinding.
			if (x === 0 || y === 0 || x === 49 || y === 49) {
				this.buildingMatrix.set(x, y, 255);
				continue;
			}

			// Avoid pathfinding close to walls to keep space for dodging and building / wider roads.
			const wallDistance = this.wallDistanceMatrix.get(x, y);
			const exitDistance = this.exitDistanceMatrix.get(x, y);

			if (wallDistance === 1) {
				this.buildingMatrix.set(x, y, 10);
			}

			if (wallDistance >= 4 && wallDistance < 255 && exitDistance > 8) {
				potentialCenterPositions.push(new RoomPosition(x, y, this.roomName));
			}

			if (exitDistance <= 2) {
				// Avoid tiles we can't build ramparts on.
				this.buildingMatrix.set(x, y, 20);
			}

			if (exitDistance > 2 && exitDistance <= 5) {
				// Avoid area near exits and room walls to not get shot at.
				this.buildingMatrix.set(x, y, 10);

				if (exitDistance === 3) {
					potentialWallPositions.push(new RoomPosition(x, y, this.roomName));
				}
			}
		}
	}
};

/**
 * Finds center positions of all room exits.
 *
 * @return {object}
 *   Array of RoomPosition objects, keyed by exit direction.
 */
RoomPlanner.prototype.findExitCenters = function () {
	const exitCenters = {};

	for (const dir of _.keys(this.exitTiles)) {
		exitCenters[dir] = [];

		let startPos = null;
		let prevPos = null;
		for (const pos of this.exitTiles[dir]) {
			if (!startPos) {
				startPos = pos;
			}

			if (prevPos && pos.getRangeTo(prevPos) > 1) {
				// New exit block started.
				const middlePos = new RoomPosition(Math.ceil((prevPos.x + startPos.x) / 2), Math.ceil((prevPos.y + startPos.y) / 2), this.roomName);
				exitCenters[dir].push(middlePos);

				startPos = pos;
			}

			prevPos = pos;
		}

		if (startPos) {
			// Finish last wall run.
			const middlePos = new RoomPosition(Math.ceil((prevPos.x + startPos.x) / 2), Math.ceil((prevPos.y + startPos.y) / 2), this.roomName);
			exitCenters[dir].push(middlePos);
		}

		for (const pos of exitCenters[dir]) {
			this.placeFlag(pos, 'exit', null);
		}
	}

	return exitCenters;
};

/**
 * Places a link near a given road.
 *
 * @param {RoomPosition[]} sourceRoads
 *   Positions that make up the road.
 * @param {string} linkType
 *   Type identifier for this link, like `source` or `controller`.
 */
RoomPlanner.prototype.placeLink = function (sourceRoads, linkType) {
	const targetPos = this.findLinkPosition(sourceRoads);

	if (!targetPos) return;

	if (linkType) {
		this.placeFlag(targetPos, 'link.' + linkType, null);
	}

	this.placeFlag(targetPos, 'link');
};

/**
 * Finds a spot for a link near a given road.
 *
 * @param {RoomPosition[]} sourceRoads
 *   Positions that make up the road.
 *
 * @return {RoomPosition}
 *   A Position at which a container can be placed.
 */
RoomPlanner.prototype.findLinkPosition = function (sourceRoads) {
	for (const pos of _.slice(sourceRoads, 0, 3)) {
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				if (this.isBuildableTile(pos.x + dx, pos.y + dy)) {
					return new RoomPosition(pos.x + dx, pos.y + dy, pos.roomName);
				}
			}
		}
	}
};

/**
 * Places a container near a given road.
 *
 * @param {RoomPosition[]} sourceRoads
 *   Positions that make up the road.
 * @param {string} containerType
 *   Type identifier for this container, like `source` or `controller`.
 */
RoomPlanner.prototype.placeContainer = function (sourceRoads, containerType) {
	const targetPos = this.findContainerPosition(sourceRoads);

	if (!targetPos) return;

	if (containerType) {
		this.placeFlag(targetPos, 'container.' + containerType, null);
	}

	this.placeFlag(targetPos, 'container', 1);
};

/**
 * Finds a spot for a container near a given road.
 *
 * @param {RoomPosition[]} sourceRoads
 *   Positions that make up the road.
 *
 * @return {RoomPosition}
 *   A Position at which a container can be placed.
 */
RoomPlanner.prototype.findContainerPosition = function (sourceRoads) {
	if (this.isBuildableTile(sourceRoads[1].x, sourceRoads[1].y, true)) {
		return sourceRoads[1];
	}

	if (this.isBuildableTile(sourceRoads[0].x, sourceRoads[0].y, true)) {
		return sourceRoads[0];
	}

	for (const pos of _.slice(sourceRoads, 0, 3)) {
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				if (this.isBuildableTile(pos.x + dx, pos.y + dy, true)) {
					return new RoomPosition(pos.x + dx, pos.y + dy, pos.roomName);
				}
			}
		}
	}
};

/**
 * Places structures that are fixed to the room's center.
 */
RoomPlanner.prototype.placeRoomCore = function () {
	// Fill center cross with roads.
	this.placeFlag(new RoomPosition(this.roomCenter.x - 1, this.roomCenter.y, this.roomName), 'road', 1);
	this.placeFlag(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y, this.roomName), 'road', 1);
	this.placeFlag(new RoomPosition(this.roomCenter.x, this.roomCenter.y - 1, this.roomName), 'road', 1);
	this.placeFlag(new RoomPosition(this.roomCenter.x, this.roomCenter.y + 1, this.roomName), 'road', 1);
	this.placeFlag(new RoomPosition(this.roomCenter.x, this.roomCenter.y, this.roomName), 'road', 1);

	// Mark center buildings for construction.
	this.placeFlag(new RoomPosition(this.roomCenter.x - 1, this.roomCenter.y + 1, this.roomName), 'storage');
	this.placeFlag(new RoomPosition(this.roomCenter.x - 1, this.roomCenter.y - 1, this.roomName), 'terminal');
	this.placeFlag(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y + 1, this.roomName), 'lab');
	this.placeFlag(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y - 1, this.roomName), 'link');
	this.placeFlag(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y - 1, this.roomName), 'link.storage');
};

/**
 * Places parking spot for helper creep.
 */
RoomPlanner.prototype.placeHelperParkingLot = function () {
	const nextPos = this.getNextAvailableBuildSpot();
	if (!nextPos) return;

	this.placeFlag(nextPos, 'road', 255);
	this.placeFlag(nextPos, 'helper_parking');

	this.placeAccessRoad(nextPos);

	this.filterOpenList(utilities.encodePosition(nextPos));
};

/**
 * Places extension bays.
 */
RoomPlanner.prototype.placeBays = function () {
	while (this.canPlaceMore('extension')) {
		const pos = this.findBayPosition();
		if (!pos) break;

		this.placeAccessRoad(pos);

		// Make sure there is a road in the center of the bay.
		this.placeFlag(pos, 'road', 1);
		this.placeFlag(pos, 'bay_center', 1);

		// Fill other unused spots with extensions.
		utilities.handleMapArea(pos.x, pos.y, (x, y) => {
			if (!this.isBuildableTile(x, y)) return;

			this.placeFlag(new RoomPosition(x, y, pos.roomName), 'extension');
			this.placeFlag(new RoomPosition(x, y, pos.roomName), 'extension.bay');
		});

		// Reinitialize pathfinding.
		this.startBuildingPlacement();
	}
};

/**
 * Finds best position to place a new bay at.
 *
 * @return {RoomPosition}
 *   The calculated position.
 */
RoomPlanner.prototype.findBayPosition = function () {
	let maxExtensions = 0;
	let bestPos = null;
	let bestScore = 0;

	while (maxExtensions < 8) {
		const nextPos = this.getNextAvailableBuildSpot();
		if (!nextPos) break;

		// Don't build too close to exits.
		if (this.exitDistanceMatrix.get(nextPos.x, nextPos.y) < 8) continue;

		if (!this.isBuildableTile(nextPos.x, nextPos.y)) continue;

		// @todo One tile is allowed to be a road.
		let tileCount = 0;
		if (this.isBuildableTile(nextPos.x - 1, nextPos.y)) tileCount++;
		if (this.isBuildableTile(nextPos.x + 1, nextPos.y)) tileCount++;
		if (this.isBuildableTile(nextPos.x, nextPos.y - 1)) tileCount++;
		if (this.isBuildableTile(nextPos.x, nextPos.y + 1)) tileCount++;
		if (this.isBuildableTile(nextPos.x - 1, nextPos.y - 1)) tileCount++;
		if (this.isBuildableTile(nextPos.x + 1, nextPos.y - 1)) tileCount++;
		if (this.isBuildableTile(nextPos.x - 1, nextPos.y + 1)) tileCount++;
		if (this.isBuildableTile(nextPos.x + 1, nextPos.y + 1)) tileCount++;

		if (tileCount <= maxExtensions) continue;

		maxExtensions = tileCount;
		const score = tileCount / (this.getCurrentBuildSpotInfo().range + 10);
		if (score > bestScore && tileCount >= 4) {
			bestPos = nextPos;
			bestScore = score;
		}
	}

	if (maxExtensions < 4) return null;

	return bestPos;
};

/**
 * Places labs in big compounds.
 */
RoomPlanner.prototype.placeLabs = function () {
	while (this.canPlaceMore('lab')) {
		const nextPos = this.getNextAvailableBuildSpot();
		if (!nextPos) break;

		// Don't build too close to exits.
		if (this.exitDistanceMatrix.get(nextPos.x, nextPos.y) < 8) continue;

		// @todo Dynamically generate lab layout for servers where 10 labs is not the max.
		// @todo Allow rotating this blueprint for better access.
		if (!this.isBuildableTile(nextPos.x, nextPos.y)) continue;
		if (!this.isBuildableTile(nextPos.x - 1, nextPos.y)) continue;
		if (!this.isBuildableTile(nextPos.x + 1, nextPos.y)) continue;
		if (!this.isBuildableTile(nextPos.x, nextPos.y - 1)) continue;
		if (!this.isBuildableTile(nextPos.x, nextPos.y + 1)) continue;
		if (!this.isBuildableTile(nextPos.x - 1, nextPos.y - 1)) continue;
		if (!this.isBuildableTile(nextPos.x + 1, nextPos.y - 1)) continue;
		if (!this.isBuildableTile(nextPos.x - 1, nextPos.y + 1)) continue;
		if (!this.isBuildableTile(nextPos.x + 1, nextPos.y + 1)) continue;
		if (!this.isBuildableTile(nextPos.x - 1, nextPos.y + 2)) continue;
		if (!this.isBuildableTile(nextPos.x, nextPos.y + 2)) continue;
		if (!this.isBuildableTile(nextPos.x + 1, nextPos.y + 2)) continue;

		// Place center area.
		this.placeFlag(new RoomPosition(nextPos.x - 1, nextPos.y, nextPos.roomName), 'lab');
		this.placeFlag(new RoomPosition(nextPos.x, nextPos.y, nextPos.roomName), 'road', 1);

		this.placeFlag(new RoomPosition(nextPos.x + 1, nextPos.y, nextPos.roomName), 'lab');
		this.placeFlag(new RoomPosition(nextPos.x - 1, nextPos.y + 1, nextPos.roomName), 'lab');
		this.placeFlag(new RoomPosition(nextPos.x, nextPos.y + 1, nextPos.roomName), 'road', 1);

		this.placeFlag(new RoomPosition(nextPos.x + 1, nextPos.y + 1, nextPos.roomName), 'lab');

		this.placeAccessRoad(nextPos);

		// Add top and bottom buildings.
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 2; dy += 3) {
				if (this.isBuildableTile(nextPos.x + dx, nextPos.y + dy)) {
					this.placeFlag(new RoomPosition(nextPos.x + dx, nextPos.y + dy, nextPos.roomName), 'lab');
				}
			}
		}

		// Reinitialize pathfinding.
		this.startBuildingPlacement();
	}
};

/**
 * Places towers so exits are well covered.
 */
RoomPlanner.prototype.placeTowers = function () {
	const positions = this.findTowerPositions();
	while (this.canPlaceMore('tower')) {
		let info = null;
		let bestDir = null;
		for (const dir of _.keys(positions)) {
			for (const tile of positions[dir].tiles) {
				if (!info || positions[bestDir].count > positions[dir].count || (info.score < tile.score && positions[bestDir].count === positions[dir].count)) {
					info = tile;
					bestDir = dir;
				}
			}
		}

		if (!info) break;

		info.score = -1;

		// Make sure it's possible to refill this tower.
		const matrix = this.buildingMatrix;
		const result = PathFinder.search(info.pos, this.roomCenterEntrances, {
			roomCallback: () => matrix,
			maxRooms: 1,
			plainCost: 1,
			swampCost: 1, // We don't care about cost, just about possibility.
		});
		if (result.incomplete) continue;

		positions[bestDir].count++;
		this.placeFlag(new RoomPosition(info.pos.x, info.pos.y, info.pos.roomName), 'tower');
	}

	// Also create roads to all towers.
	for (const posName of _.keys(this.memory.locations.tower)) {
		const pos = utilities.decodePosition(posName);

		this.placeAccessRoad(pos);
	}
};

/**
 * Places walls around spawns so creeps don't get spawned on inaccessible tiles.
 */
RoomPlanner.prototype.placeSpawnWalls = function () {
	const positions = this.getLocations('spawn');

	for (const pos of positions) {
		utilities.handleMapArea(pos.x, pos.y, (x, y) => {
			if (this.isBuildableTile(x, y)) {
				// Check if any adjacent tile has a road, which means creeps can leave from there.
				let hasRoad = false;
				utilities.handleMapArea(x, y, (ax, ay) => {
					if (this.buildingMatrix.get(ax, ay) === 1) {
						hasRoad = true;
						return false;
					}
				});
				if (hasRoad) return;

				// Place a wall to prevent spawning in this direction.
				this.placeFlag(new RoomPosition(x, y, pos.roomName), 'wall');
				this.placeFlag(new RoomPosition(x, y, pos.roomName), 'wall.blocker');
			}
		});
	}
};

/**
 * Places all remaining structures of a given type.
 *
 * @param {string} structureType
 *   The type of structure to plan.
 * @param {boolean} addRoad
 *   Whether an access road should be added for these structures.
 */
RoomPlanner.prototype.placeAll = function (structureType, addRoad) {
	while (this.canPlaceMore(structureType)) {
		const nextPos = this.getNextAvailableBuildSpot();
		if (!nextPos) break;

		this.placeFlag(new RoomPosition(nextPos.x, nextPos.y, this.roomName), structureType);
		this.filterOpenList(utilities.encodePosition(nextPos));

		if (addRoad) this.placeAccessRoad(nextPos);
	}
};

/**
 * Plans a road from the given position to the room's center.
 *
 * @param {RoomPosition} position
 *   Source position from which to start the road.
 */
RoomPlanner.prototype.placeAccessRoad = function (position) {
	// Plan road out of labs.
	const accessRoads = this.scanAndAddRoad(position, this.roomCenterEntrances);
	for (const pos of accessRoads) {
		this.placeFlag(pos, 'road', 1);
	}
};

/**
 * Initializes pathfinding for finding building placement spots.
 */
RoomPlanner.prototype.startBuildingPlacement = function () {
	// Flood fill from the center to place buildings that need to be accessible.
	this.openList = {};
	this.closedList = {};
	const startPath = {};
	startPath[utilities.encodePosition(this.roomCenter)] = true;
	this.openList[utilities.encodePosition(this.roomCenter)] = {
		range: 0,
		path: startPath,
	};
};

/**
 * Gets the next reasonable building placement location.
 *
 * @return {RoomPosition}
 *   A buildable spot.
 */
RoomPlanner.prototype.getNextAvailableBuildSpot = function () {
	while (_.size(this.openList) > 0) {
		let minDist = null;
		let nextPos = null;
		let nextInfo = null;
		_.each(this.openList, (info, posName) => {
			const pos = utilities.decodePosition(posName);
			if (!minDist || info.range < minDist) {
				minDist = info.range;
				nextPos = pos;
				nextInfo = info;
			}
		});

		if (!nextPos) break;

		delete this.openList[utilities.encodePosition(nextPos)];
		this.closedList[utilities.encodePosition(nextPos)] = true;

		// Add unhandled adjacent tiles to open list.
		utilities.handleMapArea(nextPos.x, nextPos.y, (x, y) => {
			if (x === nextPos.x && y === nextPos.y) return;
			if (!this.isBuildableTile(x, y, true)) return;

			const pos = new RoomPosition(x, y, this.roomName);
			const posName = utilities.encodePosition(pos);
			if (this.openList[posName] || this.closedList[posName]) return;

			const newPath = {};
			for (const oldPos of _.keys(nextInfo.path)) {
				newPath[oldPos] = true;
			}

			newPath[posName] = true;
			this.openList[posName] = {
				range: minDist + 1,
				path: newPath,
			};
		});

		// Don't build to close to room center.
		if (nextPos.getRangeTo(this.roomCenter) < 3) continue;

		// Don't build on roads.
		if (!this.isBuildableTile(nextPos.x, nextPos.y)) continue;

		this.currentBuildSpot = {
			pos: nextPos,
			info: nextInfo,
		};
		return nextPos;
	}
};

/**
 * Gets information about the most recently requested build spot.
 *
 * @return {object}
 *   Info avoud the build spot, containing:
 *   - range: Distance from room center.
 *   - path: An object keyed by room positions that have been traversed.
 */
RoomPlanner.prototype.getCurrentBuildSpotInfo = function () {
	return this.currentBuildSpot.info;
};

/**
 * Checks if a structure can be placed on the given tile.
 *
 * @param {number} x
 *   x coordinate of the position to check.
 * @param {number} y
 *   y coordinate of the position to check.
 * @param {boolean} allowRoads
 *   Whether to allow building placement on a road.
 *
 * @return {boolean}
 *   True if building on the given coordinates is allowed.
 */
RoomPlanner.prototype.isBuildableTile = function (x, y, allowRoads) {
	// Only build on valid terrain.
	if (this.wallDistanceMatrix.get(x, y) > 100) return false;

	// Don't build too close to exits.
	if (this.exitDistanceMatrix.get(x, y) < 6) return false;

	const matrixValue = this.buildingMatrix.get(x, y);
	// Can't build on other buildings.
	if (matrixValue > 100) return false;

	// Tiles next to walls are fine for building, just not so much for pathing.
	if (matrixValue === 10 && this.wallDistanceMatrix.get(x, y) < 3) return true;

	// @todo Find out why this check was initially introduced.
	if (matrixValue > 1) return false;

	// Don't build on roads if not allowed.
	if (matrixValue === 1 && !allowRoads) return false;

	return true;
};

/**
 * Determines whether more of a certain structure could be placed.
 *
 * @param {string} structureType
 *   The type of structure to check for.
 *
 * @return {boolean}
 *   True if the current controller level allows more of this structure.
 */
RoomPlanner.prototype.canPlaceMore = function (structureType) {
	return _.size(this.memory.locations[structureType] || []) < CONTROLLER_STRUCTURES[structureType][MAX_ROOM_LEVEL];
};

/**
 * Removes all pathfinding options that use the given position.
 *
 * @param {string} targetPos
 *   An encoded room position that should not be used in paths anymore.
 */
RoomPlanner.prototype.filterOpenList = function (targetPos) {
	for (const posName in this.openList) {
		if (this.openList[posName].path[targetPos]) {
			delete this.openList[posName];
		}
	}
};

/**
 * Removes any walls that can not be reached from the given list of coordinates.
 *
 * @param {RoomPosition[]} walls
 *   Positions where walls are currently planned.
 * @param {string[]} startLocations
 *   Encoded positions from where to start flood filling.
 * @param {boolean} onlyRelevant
 *   Only check walls that have been declared as relevant in a previous pass.
 */
RoomPlanner.prototype.pruneWallFromTiles = function (walls, startLocations, onlyRelevant) {
	const openList = {};
	const closedList = {};
	let safetyValue = 1;

	for (const location of startLocations) {
		openList[location] = true;
	}

	// If we're doing an additionall pass, unmark walls first.
	if (onlyRelevant) {
		safetyValue = 2;
		for (const wall of walls) {
			wall.isIrrelevant = true;
			if (wall.isRelevant) {
				wall.isIrrelevant = false;
				wall.isRelevant = false;
			}
		}
	}

	// Flood fill, marking all walls we touch as relevant.
	while (_.size(openList) > 0) {
		const nextPos = utilities.decodePosition(_.first(_.keys(openList)));

		// Record which tiles are safe or unsafe.
		this.safetyMatrix.set(nextPos.x, nextPos.y, safetyValue);

		delete openList[utilities.encodePosition(nextPos)];
		closedList[utilities.encodePosition(nextPos)] = true;

		this.checkForAdjacentWallsToPrune(nextPos, walls, openList, closedList);
	}
};

/**
 * Checks tiles adjacent to this one.
 * Marks ramparts as relevant and adds open positions to open list.
 *
 * @param {RoomPosition} targetPos
 *   The position to check around.
 * @param {RoomPosition[]} walls
 *   Positions where walls are currently planned.
 * @param {object} openList
 *   List of tiles to check, keyed by encoded tile position.
 * @param {object} closedList
 *   List of tiles that have been checked, keyed by encoded tile position.
 */
RoomPlanner.prototype.checkForAdjacentWallsToPrune = function (targetPos, walls, openList, closedList) {
	// Add unhandled adjacent tiles to open list.
	utilities.handleMapArea(targetPos.x, targetPos.y, (x, y) => {
		if (x === targetPos.x && y === targetPos.y) return;
		if (x < 1 || x > 48 || y < 1 || y > 48) return;

		// Ignore walls.
		if (this.wallDistanceMatrix.get(x, y) > 100) return;

		const posName = utilities.encodePosition(new RoomPosition(x, y, this.roomName));
		if (openList[posName] || closedList[posName]) return;

		// If there's a rampart to be built there, mark it and move on.
		let wallFound = false;
		for (const wall of walls) {
			if (wall.x !== x || wall.y !== y) continue;

			// Skip walls that might have been discarded in a previous pass.
			if (wall.isIrrelevant) continue;

			wall.isRelevant = true;
			wallFound = true;
			closedList[posName] = true;
			break;
		}

		if (!wallFound) {
			openList[posName] = true;
		}
	});
};

/**
 * Marks all walls which are adjacent to the "inner area" of the room.
 *
 * @param {RoomPosition[]} walls
 *   Positions where walls are currently planned.
 */
RoomPlanner.prototype.pruneWalls = function (walls) {
	const roomCenter = this.getRoomCenter();
	this.safetyMatrix = new PathFinder.CostMatrix();

	const openList = [];
	openList.push(utilities.encodePosition(roomCenter));
	// @todo Include sources, minerals, controller.
	if (this.room) {
		openList.push(utilities.encodePosition(this.room.controller.pos));
		const sources = this.room.find(FIND_SOURCES);
		for (const source of sources) {
			openList.push(utilities.encodePosition(source.pos));
		}

		const minerals = this.room.find(FIND_MINERALS);
		for (const mineral of minerals) {
			openList.push(utilities.encodePosition(mineral.pos));
		}
	}

	this.pruneWallFromTiles(walls, openList);

	// Do a second pass, checking which walls get touched by unsafe exits.

	// Prepare CostMatrix and exit points.
	const exits = [];

	for (let i = 0; i < 50; i++) {
		if (this.terrain.get(0, i) !== TERRAIN_MASK_WALL && (!this.memory.adjacentSafe || !this.memory.adjacentSafe.W)) {
			exits.push(utilities.encodePosition(new RoomPosition(0, i, this.roomName)));
		}

		if (this.terrain.get(49, i) !== TERRAIN_MASK_WALL && (!this.memory.adjacentSafe || !this.memory.adjacentSafe.E)) {
			exits.push(utilities.encodePosition(new RoomPosition(49, i, this.roomName)));
		}

		if (this.terrain.get(i, 0) !== TERRAIN_MASK_WALL && (!this.memory.adjacentSafe || !this.memory.adjacentSafe.N)) {
			exits.push(utilities.encodePosition(new RoomPosition(i, 0, this.roomName)));
		}

		if (this.terrain.get(i, 49) !== TERRAIN_MASK_WALL && (!this.memory.adjacentSafe || !this.memory.adjacentSafe.S)) {
			exits.push(utilities.encodePosition(new RoomPosition(i, 49, this.roomName)));
		}
	}

	this.pruneWallFromTiles(walls, exits, true);

	// Safety matrix has been filled, now mark any tiles unsafe that can be reached by a ranged attacker.
	for (let x = 0; x < 50; x++) {
		for (let y = 0; y < 50; y++) {
			// Only check around unsafe tiles.
			if (this.safetyMatrix.get(x, y) !== 2) continue;

			this.markTilesInRangeOfUnsafeTile(x, y);
		}
	}
};

/**
 * Mark tiles that can be reached by ranged creeps outside our walls as unsafe.
 *
 * @param {number} x
 *   x position of the a tile that is unsafe.
 * @param {number} y
 *   y position of the a tile that is unsafe.
 */
RoomPlanner.prototype.markTilesInRangeOfUnsafeTile = function (x, y) {
	utilities.handleMapArea(x, y, (ax, ay) => {
		if (this.safetyMatrix.get(ax, ay) === 1) {
			// Safe tile in range of an unsafe tile, mark as neutral.
			this.safetyMatrix.set(ax, ay, 0);
		}
	}, 3);
};

/**
 * Tries to create a road from a target point.
 *
 * @param {RoomPosition} from
 *   Position from where to start road creation. The position itself will not
 *   have a road built on it.
 * @param {RoomPosition|RoomPosition[]} to
 *   Position or positions to lead the road to.
 *
 * @return {RoomPosition[]}
 *   Positions that make up the newly created road.
 */
RoomPlanner.prototype.scanAndAddRoad = function (from, to) {
	const matrix = this.buildingMatrix;
	const result = PathFinder.search(from, to, {
		roomCallback: () => matrix,
		maxRooms: 1,
		plainCost: 2,
		swampCost: 2, // Swamps are more expensive to build roads on, but once a road is on them, creeps travel at the same speed.
		heuristicWeight: 0.9,
	});

	if (!result.path) return [];

	const newRoads = [];
	for (const pos of result.path) {
		this.roads.push(pos);
		newRoads.push(pos);

		// Since we're building a road on this tile anyway, prefer it for future pathfinding.
		if (matrix.get(pos.x, pos.y) < 100) matrix.set(pos.x, pos.y, 1);
	}

	return newRoads;
};

/**
 * Checks which adjacent rooms are owned by ourselves or otherwise safe.
 */
RoomPlanner.prototype.checkAdjacentRooms = function () {
	if (!this.memory.adjacentSafe) {
		this.memory.adjacentSafe = {
			N: false,
			E: false,
			S: false,
			W: false,
		};
	}

	const newStatus = hivemind.roomIntel(this.roomName).calculateAdjacentRoomSafety();
	this.memory.adjacentSafeRooms = newStatus.safeRooms;

	// Check if status changed since last check.
	for (const dir in newStatus.directions) {
		if (newStatus.directions[dir] !== this.memory.adjacentSafe[dir]) {
			// Status has changed, recalculate building positioning.
			hivemind.log('room plan', this.roomName).debug('changed adjacent room status!');
			Game.notify(
				'🛡 Exit safety has changed for room ' + this.room.name + '!\n\n' +
				'N: ' + (this.memory.adjacentSafe.N ? 'safe' : 'not safe') + ' -> ' + (newStatus.directions.N ? 'safe' : 'not safe') + '\n' +
				'E: ' + (this.memory.adjacentSafe.E ? 'safe' : 'not safe') + ' -> ' + (newStatus.directions.E ? 'safe' : 'not safe') + '\n' +
				'S: ' + (this.memory.adjacentSafe.S ? 'safe' : 'not safe') + ' -> ' + (newStatus.directions.S ? 'safe' : 'not safe') + '\n' +
				'W: ' + (this.memory.adjacentSafe.W ? 'safe' : 'not safe') + ' -> ' + (newStatus.directions.W ? 'safe' : 'not safe') + '\n'
			);
			delete this.memory.locations;
			this.memory.adjacentSafe = newStatus.directions;
			break;
		}
	}
};

/**
 * Gets list of safe neighboring rooms.
 *
 * @return {string[]}
 *   An array of room names.
 */
RoomPlanner.prototype.getAdjacentSafeRooms = function () {
	return this.memory.adjacentSafeRooms || [];
};

/**
 * Gets the room's center position.
 *
 * @return {RoomPosition}
 *   The center position determined by planning.
 */
RoomPlanner.prototype.getRoomCenter = function () {
	for (const pos of this.getLocations('center')) {
		return pos;
	}

	// @todo Remove once we can guarantee there always is a center.
	return new RoomPosition(25, 25, this.roomName);
};

/**
 * Returns all positions planned for a certain type.
 *
 * @param {string} locationType
 *   Type of location to get positions for.
 *
 * @return {RoomPosition[]}
 *   An Array of positions where the given location type is planned.
 */
RoomPlanner.prototype.getLocations = function (locationType) {
	if (this.memory.locations && this.memory.locations[locationType]) {
		return _.map(_.keys(this.memory.locations[locationType]), utilities.decodePosition);
	}

	return [];
};

/**
 * Checks whether a certain position is planned for building something.
 *
 * @param {RoomPosition} pos
 *   Room position to check against.
 * @param {string} locationType
 *   Type of location to check for.
 *
 * @return {boolean}
 *   True if the given location type is planned for the given position.
 */
RoomPlanner.prototype.isPlannedLocation = function (pos, locationType) {
	if (!this.memory.locations) return false;
	if (!this.memory.locations[locationType]) return false;
	if (!this.memory.locations[locationType][utilities.encodePosition(pos)]) return false;

	return true;
};

/**
 * Checks whether planning for this room is finished.
 *
 * @return {boolean}
 *   Whether all structures have been planned for this room.
 */
RoomPlanner.prototype.isPlanningFinished = function () {
	if (!this.memory.locations) return false;
	if (!this.memory.locations.observer && this.memory.planningTries <= 10) return false;

	return true;
};

module.exports = RoomPlanner;
