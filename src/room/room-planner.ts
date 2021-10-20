/* global PathFinder Room RoomPosition RoomVisual OBSTACLE_OBJECT_TYPES
CONTROLLER_STRUCTURES TERRAIN_MASK_WALL FIND_SOURCES FIND_MINERALS */

declare global {
	interface Room {
		roomPlanner: RoomPlanner,
	}

	interface RoomMemory {
		roomPlanner?: any,
	}

	interface RoomPosition {
		isIrrelevant?: boolean,
		isRelevant?: boolean,
	}
}

interface ScoredTowerPosition {
	pos: RoomPosition,
	score: number,
}

import cache from 'utils/cache';
import hivemind from 'hivemind';
import minCut from 'utils/mincut';
import RoomPlan from 'room/room-plan';
import utilities from 'utilities';
import {getRoomPlanFor, setRoomPlanFor} from 'room/room-plan-management';


const MAX_ROOM_LEVEL = 8;

export default class RoomPlanner {

	activeRoomPlan: RoomPlan;
	inProgressRoomPlan: RoomPlan;
	roomPlannerVersion: number;
	roomName: string;
	room: Room;
	minCut;
	minCutBounds: MinCutRect[];
	memory;
	buildingMatrix: CostMatrix;
	terrain: RoomTerrain;
	safetyMatrix: CostMatrix;
	exitTiles;
	wallDistanceMatrix: CostMatrix;
	exitDistanceMatrix: CostMatrix;
	roads: RoomPosition[];
	roomCenter: RoomPosition;
	roomCenterEntrances: RoomPosition[];
	openList;
	closedList;
	currentBuildSpot;

	/**
	 * Creates a room layout and makes sure the room is built accordingly.
	 * @constructor
	 *
	 * @param {string} roomName
	 *   Name of the room this room planner is assigned to.
	 */
	constructor(roomName: string) {
		this.roomPlannerVersion = 35;
		this.roomName = roomName;
		this.activeRoomPlan = getRoomPlanFor(roomName);
		this.room = Game.rooms[roomName]; // Will not always be available.
		if (hivemind.settings.get('enableMinCutRamparts')) {
			this.minCut = minCut;
			this.minCutBounds = [];
		}

		const key = 'planner:' + roomName;
		if (!hivemind.segmentMemory.has(key)) {
			hivemind.segmentMemory.set(key, {});
		}

		this.memory = hivemind.segmentMemory.get(key);
		if (this.memory.inProgressRoomPlan) this.inProgressRoomPlan = new RoomPlan(this.roomName, this.roomPlannerVersion, this.memory.inProgressRoomPlan);

		if (this.inProgressRoomPlan) {
			this.inProgressRoomPlan.visualize();
		}
		if (this.activeRoomPlan && (this.memory.drawDebug || 0) > 0) {
			this.memory.drawDebug--;
			this.activeRoomPlan.visualize();
		}
	};

	/**
	 * Allows this room planner to give commands in controlled rooms.
	 */
	runLogic() {
		if (Game.cpu.bucket < 3500) return;
		if (!hivemind.segmentMemory.isReady()) return;

		// Recalculate room layout if using a new version.
		if (!this.activeRoomPlan || this.activeRoomPlan.getVersion() !== this.roomPlannerVersion) {
			if (!this.inProgressRoomPlan) {
				delete this.memory.planningTries;
				this.inProgressRoomPlan = new RoomPlan(this.roomName, this.roomPlannerVersion);
			}
		}

		// Sometimes room planning can't be finished successfully. Try a maximum of 10
		// times in that case.
		if (!this.memory.planningTries) this.memory.planningTries = 0;

		if (!this.isPlanningFinished()) {
			if (Game.cpu.getUsed() < Game.cpu.tickLimit / 2) {
				this.placeFlags();
				this.memory.planningTries++;

				this.memory.inProgressRoomPlan = this.inProgressRoomPlan.serialize();
			}

			if (!this.isPlanningFinished()) return;
		}

		if (this.inProgressRoomPlan) {
			// Planning is finished, apply room plan.
			this.activeRoomPlan = this.inProgressRoomPlan;
			setRoomPlanFor(this.roomName, this.inProgressRoomPlan);
			hivemind.log('rooms', this.roomName).info('Stored room plan for room ' + this.roomName);
			delete this.inProgressRoomPlan;
			delete this.memory.inProgressRoomPlan;

			// Show result of planning for a few ticks.
			// @todo Make configurable.
			this.memory.drawDebug = 20;
		}

		if (this.memory.lastRun && !hivemind.hasIntervalPassed(100, this.memory.lastRun)) return;

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
	placeFlag(pos: RoomPosition, locationType: string, pathFindingCost?: number) {
		this.inProgressRoomPlan.addPosition(locationType, pos);

		if (typeof pathFindingCost === 'undefined') {
			pathFindingCost = 255;
		}

		if (pathFindingCost && this.buildingMatrix.get(pos.x, pos.y) < 100) {
			this.buildingMatrix.set(pos.x, pos.y, pathFindingCost);
		}

		if (this.minCut) {
			const baseType = locationType.split('.')[0];
			if (CONTROLLER_STRUCTURES[baseType] && ['extension', 'road', 'container', 'extractor'].indexOf(baseType) === -1) {
				// Protect area around essential structures.
				this.protectPosition(pos);
			}
			if (['road.source', 'road.controller'].indexOf(locationType) !== -1) {
				// Protect source and controller roads to prevent splitting room into
				// unconnected areas.
				this.protectPosition(pos, 0);
			}
		}
	};

	/**
	 * Adds a position to be protected by minCut.
	 */
	protectPosition(pos: RoomPosition, distance?: number) {
		if (typeof distance === 'undefined') distance = hivemind.settings.get('minCutRampartDistance');
		const x1 = Math.max(2, pos.x - distance);
		const x2 = Math.min(47, pos.x + distance);
		const y1 = Math.max(2, pos.y - distance);
		const y2 = Math.min(47, pos.y + distance);
		this.minCutBounds.push({x1, x2, y1, y2});
	};

	/**
	 * Generates CostMatrixes needed for structure placement.
	 */
	generateDistanceMatrixes() {
		const wallMatrix = new PathFinder.CostMatrix();
		const exitMatrix = new PathFinder.CostMatrix();

		this.prepareDistanceMatrixes(wallMatrix, exitMatrix);

		this.propagateDistanceValues(wallMatrix);
		this.propagateDistanceValues(exitMatrix);

		this.memory.wallDistanceMatrix = wallMatrix.serialize();
		this.memory.exitDistanceMatrix = exitMatrix.serialize();
	};

	/**
	 * Tries to fill all 0 values in the cost matrix with distance to nearest 1.
	 *
	 * @param {PathFinder.CostMatrix} matrix
	 *   The cost matrix to modify.
	 */
	propagateDistanceValues(matrix: CostMatrix) {
		// @todo Use some kind of flood fill to calculate these faster.
		let currentDistance = 1;
		let done = false;
		while (!done) {
			done = true;

			for (let x = 0; x < 50; x++) {
				for (let y = 0; y < 50; y++) {
					if (this.markDistanceTiles(matrix, currentDistance, x, y)) done = false;
				}
			}

			currentDistance++;
		}
	}

	/**
	 * Initializes wall and exit distance matrix with walls and adjacent tiles.
	 *
	 * @param {PathFinder.CostMatrix} wallMatrix
	 *   Matrix that will have a 1 next to every wall tile.
	 * @param {PathFinder.CostMatrix} exitMatrix
	 *   Matrix that will have a 1 at every exit tile.
	 */
	prepareDistanceMatrixes(wallMatrix: CostMatrix, exitMatrix: CostMatrix) {
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
	markWallAdjacentTiles(matrix: CostMatrix, x: number, y: number) {
		utilities.handleMapArea(x, y, (ax, ay) => {
			if (this.terrain.get(ax, ay) === TERRAIN_MASK_WALL) {
				matrix.set(x, y, 1);
				return false;
			}

			return true;
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
	markDistanceTiles(matrix: CostMatrix, distance: number, x: number, y: number): boolean {
		if (matrix.get(x, y) !== 0) return false;

		let modified = false;
		utilities.handleMapArea(x, y, (ax, ay) => {
			if (matrix.get(ax, ay) === distance) {
				matrix.set(x, y, distance + 1);
				modified = true;
				return false;
			}

			return true;
		});

		return modified;
	};

	/**
	 * Makes plans for a room and place flags to visualize.
	 */
	placeFlags() {
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

		const roomIntel = hivemind.roomIntel(this.roomName);

		// Reset location memory, to be replaced with new flags.
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

		const controllerPosition = roomIntel.getControllerPosition();

		// Decide where room center should be by averaging exit positions.
		// @todo Try multiple room centers:
		// - Current version
		// - Near controller
		// - Between controller and a source
		// - Near any corner or side
		// @todo Then evaluate best result by:
		// - Upkeep costs (roads, ramparts)
		// - Path lengths (Bays, sources, controller)
		let cx = controllerPosition.x;
		let cy = controllerPosition.y;
		let count = 1;
		for (const dir of _.keys(exitCenters)) {
			for (const pos of exitCenters[dir]) {
				count++;
				cx += pos.x;
				cy += pos.y;
			}
		}
		// Also include source and mineral positions when determining room center.
		const mineralInfo = roomIntel.getMineralPosition();
		if (mineralInfo) {
			count++;
			cx += mineralInfo.x;
			cy += mineralInfo.y;
		}

		const sourceInfo = roomIntel.getSourcePositions();
		for (const source of sourceInfo) {
			count++;
			cx += source.x;
			cy += source.y;
		}

		cx = Math.floor(cx / count);
		cy = Math.floor(cy / count);

		// Find closest position with distance from walls around there.
		const roomCenter = (new RoomPosition(cx, cy, this.roomName)).findClosestByRange(potentialCenterPositions);
		if (!roomCenter) {
			hivemind.log('rooms', this.roomName).error('Could not find a suitable center position!', utilities.renderCostMatrix(this.wallDistanceMatrix), utilities.renderCostMatrix(this.exitDistanceMatrix), utilities.renderCostMatrix(this.buildingMatrix));
			return;
		}
		this.roomCenter = roomCenter;
		this.placeFlag(roomCenter, 'center', null);

		if (this.minCut) {
			this.protectPosition(controllerPosition, 1);
		}
		else {
			// Do another flood fill pass from interesting positions to remove walls that don't protect anything.
			this.pruneWalls(potentialWallPositions);

			// Actually place ramparts.
			for (const i in potentialWallPositions) {
				if (potentialWallPositions[i].isRelevant) {
					this.placeFlag(potentialWallPositions[i], 'rampart', null);
				}
			}
		}

		// Center is accessible via the 4 cardinal directions.
		this.roomCenterEntrances = [
			new RoomPosition(roomCenter.x + 2, roomCenter.y, this.roomName),
			new RoomPosition(roomCenter.x - 2, roomCenter.y, this.roomName),
			new RoomPosition(roomCenter.x, roomCenter.y + 2, this.roomName),
			new RoomPosition(roomCenter.x, roomCenter.y - 2, this.roomName),
		];

		this.memory.sources = {};
		if (this.room && this.room.sources) {
			for (const source of this.room.sources) {
				// Find adjacent space that will provide most building space.
				let bestPos;
				utilities.handleMapArea(source.pos.x, source.pos.y, (x, y) => {
					if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;

					let numFreeTiles = 0;
					utilities.handleMapArea(x, y, (x2, y2) => {
						if (this.terrain.get(x2, y2) === TERRAIN_MASK_WALL) return;
						if (this.buildingMatrix.get(x2, y2) >= 100) return;

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

				// Make sure no other paths get led through harvester position.
				this.buildingMatrix.set(harvestPosition.x, harvestPosition.y, 255);

				// Setup memory for quick access to harvest spots.
				this.memory.sources[source.id] = {
					harvestPos: utilities.serializePosition(harvestPosition, this.roomName),
				};
			}
		}

		// Find paths from each exit towards the room center for making roads.
		for (const dir of _.keys(exitCenters)) {
			for (const pos of exitCenters[dir]) {
				this.scanAndAddRoad(pos, this.roomCenterEntrances);
			}
		}

		// Add road to controller.
		// @todo Create road starting from room center, and only to range 3.
		const controllerRoads = this.scanAndAddRoad(controllerPosition, this.roomCenterEntrances);
		for (const pos of controllerRoads) {
			this.placeFlag(pos, 'road.controller', null);
		}

		this.placeContainer(controllerRoads, 'controller');

		// Make sure no other paths get led through upgrader position.
		this.buildingMatrix.set(controllerRoads[0].x, controllerRoads[0].y, 255);

		// Place a link near controller, but off the calculated path.
		this.placeLink(controllerRoads, 'controller');

		if (this.room) {
			// @todo Have intelManager save locations (not just IDs) of minerals, so we don't need room access here.
			// @todo Use source positions from room intel.
			// We also save which road belongs to which path, so we can selectively autobuild roads during room bootstrap instead of building all roads at once.

			if (this.room.mineral) {
				this.placeFlag(this.room.mineral.pos, 'extractor');
				const mineralRoads = this.scanAndAddRoad(this.room.mineral.pos, this.roomCenterEntrances);
				for (const pos of mineralRoads) {
					this.placeFlag(pos, 'road.mineral', null);
				}

				this.placeContainer(mineralRoads, 'mineral');

				// Make sure no other paths get led through harvester position.
				this.buildingMatrix.set(mineralRoads[0].x, mineralRoads[0].y, 255);

				// Setup memory for quick access to harvest spots.
				this.memory.sources[this.room.mineral.id] = {
					harvestPos: utilities.serializePosition(mineralRoads[0], this.roomName),
				};
			}

			if (this.room.sources) {
				for (const source of this.room.sources) {
					const harvestPosition = utilities.deserializePosition(this.memory.sources[source.id].harvestPos, this.roomName);
					const sourceRoads = this.scanAndAddRoad(harvestPosition, this.roomCenterEntrances);
					for (const pos of sourceRoads) {
						this.placeFlag(pos, 'road.source', null);
					}

					this.placeFlag(harvestPosition, 'container.source', null);
					this.placeFlag(harvestPosition, 'container', null);

					if (this.canPlaceMore('spawn')) {
						utilities.handleMapArea(harvestPosition.x, harvestPosition.y, (x, y) => {
							if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return true;
							if (!this.isBuildableTile(x, y)) return true;
							if (x === harvestPosition.x && y === harvestPosition.y) return true;

							// Only place spawn where a road tile is adjacent, so creeps can
							// actually exit when a harvester is on its spot.
							let spawnPlaced = false;
							utilities.handleMapArea(x, y, (x2, y2) => {
								if (this.buildingMatrix.get(x2, y2) !== 1) return true;

								this.placeFlag(new RoomPosition(x, y, this.roomName), 'spawn');
								spawnPlaced = true;
								return false;
							});

							if (spawnPlaced) return false;

							return true;
						});
					}

					if (this.canPlaceMore('link')) {
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

		if (this.minCut) {
			// Protect exits to safe rooms.
			const bounds: MinCutRect = {x1: 0, x2: 49, y1: 0, y2: 49};
			for (const exitDir of _.keys(this.memory.adjacentSafe)) {
				if (!this.memory.adjacentSafe[exitDir]) continue;

				if (exitDir === 'N') bounds.protectTopExits = true;
				if (exitDir === 'S') bounds.protectBottomExits = true;
				if (exitDir === 'W') bounds.protectLeftExits = true;
				if (exitDir === 'E') bounds.protectRightExits = true;
			}

			const rampartCoords = this.minCut.getCutTiles(this.roomName, this.minCutBounds, bounds);
			for (const coord of rampartCoords) {
				potentialWallPositions.push(new RoomPosition(coord.x, coord.y, this.roomName));
			}

			this.pruneWalls(potentialWallPositions);

			// Actually place ramparts.
			for (const i in potentialWallPositions) {
				if (potentialWallPositions[i].isRelevant) {
					this.placeFlag(potentialWallPositions[i], 'rampart', null);
				}
			}
		}

		this.placeTowers();
		this.placeSpawnWalls();
		this.placeFlag(new RoomPosition(25, 25, this.roomName), 'planner_finished', this.buildingMatrix.get(25, 25));

		hivemind.log('rooms', this.roomName).info('Finished room planning: ', utilities.renderCostMatrix(this.buildingMatrix));

		const end = Game.cpu.getUsed();
		hivemind.log('rooms', this.roomName).info('Planning for', this.roomName, 'took', end - start, 'CPU');

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
	prepareBuildingMatrix(potentialWallPositions: RoomPosition[], potentialCenterPositions: RoomPosition[]) {
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

					if (exitDistance === 3 && !this.minCut) {
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
	findExitCenters() {
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
	placeLink(sourceRoads: RoomPosition[], linkType: string) {
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
	findLinkPosition(sourceRoads: RoomPosition[]): RoomPosition {
		for (const pos of _.slice(sourceRoads, 0, 3)) {
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					if (this.isBuildableTile(pos.x + dx, pos.y + dy)) {
						return new RoomPosition(pos.x + dx, pos.y + dy, pos.roomName);
					}
				}
			}
		}

		return null;
	};

	/**
	 * Places a container near a given road.
	 *
	 * @param {RoomPosition[]} sourceRoads
	 *   Positions that make up the road.
	 * @param {string} containerType
	 *   Type identifier for this container, like `source` or `controller`.
	 */
	placeContainer(sourceRoads: RoomPosition[], containerType: string) {
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
	findContainerPosition(sourceRoads: RoomPosition[]): RoomPosition {
		if (this.isBuildableTile(sourceRoads[0].x, sourceRoads[0].y, true)) {
			return sourceRoads[0];
		}

		if (this.isBuildableTile(sourceRoads[1].x, sourceRoads[1].y, true)) {
			return sourceRoads[1];
		}

		let targetPosition: RoomPosition;
		for (const pos of _.slice(sourceRoads, 0, 3)) {
			utilities.handleMapArea(pos.x, pos.y, (x, y) => {
				if (this.isBuildableTile(x, y, true)) {
					targetPosition = new RoomPosition(x, y, pos.roomName);
					return false;
				}

				return true;
			});
		}

		return targetPosition;
	};

	/**
	 * Places structures that are fixed to the room's center.
	 */
	placeRoomCore() {
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
		this.placeFlag(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y + 1, this.roomName), 'lab.boost');
		this.placeFlag(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y - 1, this.roomName), 'link');
		this.placeFlag(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y - 1, this.roomName), 'link.storage');
	};

	/**
	 * Places parking spot for helper creep.
	 */
	placeHelperParkingLot() {
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
	placeBays() {
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
	findBayPosition(): RoomPosition {
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
	placeLabs() {
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
			this.placeFlag(new RoomPosition(nextPos.x - 1, nextPos.y, nextPos.roomName), 'lab.reaction');
			this.placeFlag(new RoomPosition(nextPos.x, nextPos.y, nextPos.roomName), 'road', 1);

			this.placeFlag(new RoomPosition(nextPos.x + 1, nextPos.y, nextPos.roomName), 'lab');
			this.placeFlag(new RoomPosition(nextPos.x + 1, nextPos.y, nextPos.roomName), 'lab.reaction');
			this.placeFlag(new RoomPosition(nextPos.x - 1, nextPos.y + 1, nextPos.roomName), 'lab');
			this.placeFlag(new RoomPosition(nextPos.x - 1, nextPos.y + 1, nextPos.roomName), 'lab.reaction');
			this.placeFlag(new RoomPosition(nextPos.x, nextPos.y + 1, nextPos.roomName), 'road', 1);

			this.placeFlag(new RoomPosition(nextPos.x + 1, nextPos.y + 1, nextPos.roomName), 'lab');
			this.placeFlag(new RoomPosition(nextPos.x + 1, nextPos.y + 1, nextPos.roomName), 'lab.reaction');

			this.placeAccessRoad(nextPos);

			// Add top and bottom buildings.
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 2; dy += 3) {
					if (this.isBuildableTile(nextPos.x + dx, nextPos.y + dy)) {
						this.placeFlag(new RoomPosition(nextPos.x + dx, nextPos.y + dy, nextPos.roomName), 'lab');
						this.placeFlag(new RoomPosition(nextPos.x + dx, nextPos.y + dy, nextPos.roomName), 'lab.reaction');
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
	placeTowers() {
		const costMatrixBackup: {
			[location: string]: number,
		} = {};
		const positions = this.findTowerPositions();
		const ramparts = this.findRampartPositions();
		while (this.canPlaceMore('tower')) {
			const newTowers = [];

			this.scoreRampartPositions(ramparts);
			this.scoreTowerPositions(positions, ramparts);
			while(newTowers.length < this.remainingStructureCount('tower')) {
				let info = _.max(positions, 'score');
				if (!info || typeof info === 'number' || info.score < 0) break;

				info.score = -1;

				// Make sure it's possible to refill this tower.
				const result = PathFinder.search(info.pos, this.roomCenterEntrances, {
					roomCallback: () => this.buildingMatrix,
					maxRooms: 1,
					plainCost: 1,
					swampCost: 1, // We don't care about cost, just about possibility.
				});
				if (result.incomplete) continue;

				// Add tentative tower location.
				newTowers.push(info.pos);
				costMatrixBackup[utilities.encodePosition(info.pos)] = this.buildingMatrix.get(info.pos.x, info.pos.y);
				this.placeFlag(info.pos, 'tower_placeholder');

				if (newTowers.length < this.remainingStructureCount('tower')) {
					this.scoreRampartPositions(ramparts);
					this.scoreTowerPositions(positions, ramparts);
				}
			}

			// Abort if no towers can be placed.
			if (newTowers.length === 0) break;

			// Also create roads to all towers.
			for (const pos of newTowers) {
				// Check if access is still possible.
				const result = PathFinder.search(pos, this.roomCenterEntrances, {
					roomCallback: () => this.buildingMatrix,
					maxRooms: 1,
					plainCost: 1,
					swampCost: 1, // We don't care about cost, just about possibility.
				});
				// @todo Decrement counter for tower direction.
				if (result.incomplete) continue;

				this.placeFlag(pos, 'tower');
				this.placeAccessRoad(pos);
			}

			// Restore building matrix values for subsequent operations.
			for (const pos of this.inProgressRoomPlan.getPositions('tower_placeholder')) {
				if (this.inProgressRoomPlan.hasPosition('tower', pos)) continue;

				this.buildingMatrix.set(pos.x, pos.y, costMatrixBackup[utilities.encodePosition(pos)]);
			}

			// Remove tower_placeholder markers for correct scoring during next iteration.
			this.inProgressRoomPlan.removeAllPositions('tower_placeholder');
		}
	};

	/**
	 * Finds all positions where we might place towers within rampart protection.
	 *
	 * @return {array}
	 *   An array of objects with the following keys:
	 *   - score: The tower score for this position.
	 *   - pos: The position in question.
	 */
	findTowerPositions(): ScoredTowerPosition[] {
		const positions: ScoredTowerPosition[] = [];

		const allDirectionsSafe = _.sum(this.memory.adjacentSafe) === 4;
		if (allDirectionsSafe) return positions;

		for (let x = 1; x < 49; x++) {
			for (let y = 1; y < 49; y++) {
				if (this.buildingMatrix.get(x, y) !== 0 && this.buildingMatrix.get(x, y) !== 10) continue;
				if (this.safetyMatrix.get(x, y) !== 1) continue;
				if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

				positions.push({
					score: 0,
					pos: new RoomPosition(x, y, this.roomName),
				});
			}
		}

		return positions;
	}

	/**
	 * Scores all available tower positions based on rampart tiles in range.
	 *
	 * Unprotected ramparts get higher priority than those already protected
	 * by another tower.
	 */
	scoreTowerPositions(positions: ScoredTowerPosition[], rampartPositions: ScoredTowerPosition[]) {
		for (const info of positions) {
			// Skip positions already considered for tower or road placement.
			if (this.buildingMatrix.get(info.pos.x, info.pos.y) !== 0 && this.buildingMatrix.get(info.pos.x, info.pos.y) !== 10) info.score = -1;
			if (info.score < 0) continue;

			let score = 0;

			// Add score for ramparts in range.
			for (const rampart of rampartPositions) {
				score += rampart.score * this.getTowerEffectScore(rampart.pos, info.pos.x, info.pos.y);
			}

			info.score = score;
		}
	}

	/**
	 * Finds the position of all ramparts in the room.
	 */
	findRampartPositions(): ScoredTowerPosition[] {
		const positions = [];

		for (const pos of this.inProgressRoomPlan.getPositions('rampart')) {
			positions.push({
				score: 1,
				pos,
			});
		}

		return positions;
	}

	/**
	 * Calculates a weight for each rampart based on current protection level.
	 *
	 * The more towers in are in range of a rampart, the less important it is
	 * to add more protection near it.
	 */
	scoreRampartPositions(positions: ScoredTowerPosition[]) {
		for (const info of positions) {
			let rampartScore = 1;

			for (const pos of this.inProgressRoomPlan.getPositions('tower')) {
				rampartScore *= 1 - 0.8 * this.getTowerEffectScore(pos, info.pos.x, info.pos.y);
			}
			for (const pos of this.inProgressRoomPlan.getPositions('tower_placeholder')) {
				rampartScore *= 1 - 0.8 * this.getTowerEffectScore(pos, info.pos.x, info.pos.y);
			}

			info.score = rampartScore;
		}
	}

	/**
	 * Determines tower efficiency by range.
	 *
	 * @return {number}
	 *   Between 0 for least efficient and 1 for highest efficiency.
	 */
	getTowerEffectScore(pos: RoomPosition, x: number, y: number): number {
		const effectiveRange = Math.min(Math.max(pos.getRangeTo(x, y) + 2, TOWER_OPTIMAL_RANGE), TOWER_FALLOFF_RANGE);
		return 1 - ((effectiveRange - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE));
	}

	/**
	 * Places walls around spawns so creeps don't get spawned on inaccessible tiles.
	 */
	placeSpawnWalls() {
		for (const pos of this.inProgressRoomPlan.getPositions('spawn')) {
			utilities.handleMapArea(pos.x, pos.y, (x, y) => {
				if (this.isBuildableTile(x, y)) {
					// Check if any adjacent tile has a road, which means creeps can leave from there.
					let hasRoad = false;
					utilities.handleMapArea(x, y, (ax, ay) => {
						if (this.buildingMatrix.get(ax, ay) === 1) {
							hasRoad = true;
							return false;
						}

						return true;
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
	placeAll(structureType: StructureConstant, addRoad: boolean) {
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
	placeAccessRoad(position: RoomPosition) {
		// Plan road out of labs.
		const accessRoads = this.scanAndAddRoad(position, this.roomCenterEntrances);
		for (const pos of accessRoads) {
			this.placeFlag(pos, 'road', 1);
		}
	};

	/**
	 * Initializes pathfinding for finding building placement spots.
	 */
	startBuildingPlacement() {
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
	getNextAvailableBuildSpot(): RoomPosition {
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

		return null;
	};

	/**
	 * Gets information about the most recently requested build spot.
	 *
	 * @return {object}
	 *   Info avoud the build spot, containing:
	 *   - range: Distance from room center.
	 *   - path: An object keyed by room positions that have been traversed.
	 */
	getCurrentBuildSpotInfo() {
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
	isBuildableTile(x: number, y: number, allowRoads?: boolean): boolean {
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
	canPlaceMore(structureType: StructureConstant): boolean {
		return this.remainingStructureCount(structureType) > 0;
	};

	/**
	 * Determines the number of structures of a type that could be placed.
	 *
	 * @param {string} structureType
	 *   The type of structure to check for.
	 *
	 * @return {number}
	 *   The number of structures of the given type that may still be placed.
	 */
	remainingStructureCount(structureType: StructureConstant): number {
		return CONTROLLER_STRUCTURES[structureType][MAX_ROOM_LEVEL] - _.size(this.inProgressRoomPlan.getPositions(structureType) || []);
	}

	/**
	 * Removes all pathfinding options that use the given position.
	 *
	 * @param {string} targetPos
	 *   An encoded room position that should not be used in paths anymore.
	 */
	filterOpenList(targetPos: string) {
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
	pruneWallFromTiles(walls: RoomPosition[], startLocations: string[], onlyRelevant?: boolean) {
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
	checkForAdjacentWallsToPrune(targetPos: RoomPosition, walls: RoomPosition[], openList, closedList) {
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
	pruneWalls(walls: RoomPosition[]) {
		const roomCenter = _.first(this.inProgressRoomPlan.getPositions('center'));
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
	markTilesInRangeOfUnsafeTile(x: number, y: number) {
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
	scanAndAddRoad(from: RoomPosition, to: RoomPosition | RoomPosition[]): RoomPosition[] {
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
	checkAdjacentRooms() {
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
				this.inProgressRoomPlan = new RoomPlan(this.roomName, this.roomPlannerVersion);
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
	getAdjacentSafeRooms(): string[] {
		return this.memory.adjacentSafeRooms || [];
	};

	/**
	 * Gets the room's center position.
	 *
	 * @return {RoomPosition}
	 *   The center position determined by planning.
	 */
	getRoomCenter(): RoomPosition {
		for (const pos of this.getLocations('center')) {
			return pos;
		}

		// Fallback value if for some reason there is no assigned center position.
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
	getLocations(locationType: string): RoomPosition[] {
		if (this.activeRoomPlan) {
			return this.activeRoomPlan.getPositions(locationType);
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
	isPlannedLocation(pos: RoomPosition, locationType: string): boolean {
		if (!this.activeRoomPlan) return false;

		return this.activeRoomPlan.hasPosition(locationType, pos);
	};

	/**
	 * Checks whether planning for this room is finished.
	 *
	 * @return {boolean}
	 *   Whether all structures have been planned for this room.
	 */
	isPlanningFinished(): boolean {
		if (!this.inProgressRoomPlan) return true;
		if (this.inProgressRoomPlan.getPositions('planner_finished').length > 0) return true;
		if (this.memory.planningTries > 10) return true;

		return false;
	};

	/**
	 * Gets a cost matrix representing this room when it's fully built.
	 *
	 * @return {PathFinder.CostMatrix}
	 *   The requested cost matrix.
	 */
	getNavigationMatrix(): CostMatrix {
		return cache.inHeap('plannerCostMatrix:' + this.roomName, 500, () => {
			const matrix = new PathFinder.CostMatrix();

			for (const locationType of this.activeRoomPlan.getPositionTypes()) {
				if (!['road', 'harvester', 'bay_center'].includes(locationType) && !(OBSTACLE_OBJECT_TYPES as string[]).includes(locationType)) continue;

				for (const pos of this.activeRoomPlan.getPositions(locationType)) {
					if (locationType === 'road') {
						if (matrix.get(pos.x, pos.y) === 0) {
							matrix.set(pos.x, pos.y, 1);
						}
					}
					else {
						matrix.set(pos.x, pos.y, 255);
					}
				}
			}

			return matrix;
		});
	};
}
