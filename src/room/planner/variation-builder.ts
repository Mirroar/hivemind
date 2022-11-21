import hivemind from 'hivemind';
import minCut from 'utils/mincut';
import PlaceTowersStep from 'room/planner/step/place-towers';
import RoomVariationBuilderBase from 'room/planner/variation-builder-base';
import {encodePosition, decodePosition} from 'utils/serialization';
import {getExitCenters} from 'utils/room-info';
import {getRoomIntel} from 'room-intel';
import {handleMapArea} from 'utils/map';

const TILE_IS_ENDANGERED = 0;
const TILE_IS_SAFE = 1;
const TILE_IS_UNSAFE = 2;
const TILE_IS_UNSAFE_NEAR_WALL = 3;

export default class RoomVariationBuilder extends RoomVariationBuilderBase {
	exitCenters: ExitCoords;
	roomCenter: RoomPosition;
	roomCenterEntrances: RoomPosition[];
	private sourceInfo: {
		[id: string]: {
			harvestPosition: RoomPosition;
		};
	};
	private steps: (() => StepResult)[];

	safetyMatrix: CostMatrix;

	constructor(roomName: string, variation: string, protected variationInfo: VariationInfo, wallMatrix: CostMatrix, exitMatrix: CostMatrix) {
		super(roomName, variation, wallMatrix, exitMatrix);
		hivemind.log('rooms', this.roomName).info('Started generating room plan for variation', variation);

		this.steps = [
			this.gatherExitCoords,
			this.determineCorePosition,
			this.determineHarvesterPositions,
			this.determineUpgraderPosition,
			this.placeRoadNetwork,
			this.placeHarvestBayStructures,
			this.placeRoomCore,
			this.placeHelperParkingLot,
			this.placeBays,
			this.placeLabs,
			this.placeHighLevelStructures,
			// @todo Protect positions for mincut
			this.placeRamparts,
			this.sealRoom,
			this.placeTowers,
			this.placeOnRamps,
			this.placeQuadBreaker,
		];
	}

	buildStep(step: number): StepResult {
		if (step < this.steps.length) {
			return this.steps[step].call(this);
		}

		return 'done';
	}

	gatherExitCoords(): StepResult {
		// Prepare exit points.
		this.exitCenters = getExitCenters(this.roomName);

		for (const dir in this.exitCenters) {
			for (const pos of this.exitCenters[dir]) {
				this.placementManager.planLocation(pos, 'exit', null);
			}
		}

		return 'ok';
	}

	determineCorePosition(): StepResult {
		if (!this.variationInfo.roomCenter) return 'failed';

		this.roomCenter = this.variationInfo.roomCenter;

		// Center is accessible via the 4 cardinal directions.
		this.roomCenterEntrances = [
			new RoomPosition(this.roomCenter.x + 2, this.roomCenter.y, this.roomName),
			new RoomPosition(this.roomCenter.x - 2, this.roomCenter.y, this.roomName),
			new RoomPosition(this.roomCenter.x, this.roomCenter.y + 2, this.roomName),
			new RoomPosition(this.roomCenter.x, this.roomCenter.y - 2, this.roomName),
		];

		this.placementManager.planLocation(this.roomCenter, 'center', null);

		return 'ok';
	}

	determineHarvesterPositions(): StepResult {
		this.sourceInfo = {};
		const roomIntel = getRoomIntel(this.roomName);
		for (const source of roomIntel.getSourcePositions()) {
			const harvestPosition = this.determineHarvestPositionForSource(source);
			this.placementManager.planLocation(harvestPosition, 'harvester', null);
			this.placementManager.planLocation(harvestPosition, 'harvester.' + source.id, null);
			this.placementManager.planLocation(harvestPosition, 'bay_center', null);

			// Discourage roads through spots around harvest position.
			handleMapArea(harvestPosition.x, harvestPosition.y, (x, y) => {
				if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;

				this.placementManager.discouragePosition(x, y);
			});

			this.storeHarvestPosition(source, harvestPosition);
		}

		const mineral = roomIntel.getMineralPosition();
		const mineralPosition = new RoomPosition(mineral.x, mineral.y, this.roomName);
		this.placementManager.planLocation(mineralPosition, 'extractor');
		const mineralRoads = this.placementManager.findAccessRoad(mineralPosition, this.roomCenterEntrances);
		for (const pos of mineralRoads) {
			this.placementManager.planLocation(pos, 'road', 1);
			this.placementManager.planLocation(pos, 'road.mineral', null);
		}

		this.placeContainer(mineralRoads, 'mineral');

		this.storeHarvestPosition(mineral, mineralRoads[0]);

		return 'ok';
	}

	determineHarvestPositionForSource(source: {x: number; y: number}): RoomPosition {
		// Find adjacent space that will provide most building space.
		// @todo Reasonably handle sources that can be accessed from multiple
		// sides. For example by checking if theres more than 1 group of
		// unconnected free tiles.
		let bestPos;
		handleMapArea(source.x, source.y, (x, y) => {
			if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;

			let numFreeTiles = 0;
			handleMapArea(x, y, (x2, y2) => {
				if (this.terrain.get(x2, y2) === TERRAIN_MASK_WALL) return;
				if (!this.placementManager.isBuildableTile(x2, y2)) return;

				numFreeTiles++;
			});

			if (!bestPos || bestPos.numFreeTiles < numFreeTiles) {
				bestPos = {x, y, numFreeTiles};
			}
		});

		return new RoomPosition(bestPos.x, bestPos.y, this.roomName);
	}

	storeHarvestPosition(source: {id: string}, harvestPosition: RoomPosition) {
		// Make sure no other paths get led through harvester position.
		this.placementManager.blockPosition(harvestPosition.x, harvestPosition.y);

		// Setup memory for quick access to harvest spots.
		this.sourceInfo[source.id] = {
			harvestPosition,
		};
	}

	determineUpgraderPosition(): StepResult {
		const roomIntel = getRoomIntel(this.roomName);
		const controllerPosition = roomIntel.getControllerPosition();
		const controllerRoads = this.placementManager.findAccessRoad(controllerPosition, this.roomCenterEntrances);
		this.protectPosition(controllerPosition, 1);

		for (const pos of controllerRoads) {
			this.placementManager.planLocation(pos, 'road', 1);
			this.placementManager.planLocation(pos, 'road.controller', null);
			this.protectPosition(pos, 0);
		}

		// Make sure no other paths get led through upgrader position.
		this.placementManager.blockPosition(controllerRoads[0].x, controllerRoads[0].y);

		this.placeContainer(controllerRoads, 'controller');

		// Place a link near controller, but off the calculated path.
		this.placeLink(controllerRoads, 'controller');

		return 'ok';
	}

	placeRoadNetwork(): StepResult {
		// Find paths from each exit towards the room center for making roads.
		for (const dir of _.keys(this.exitCenters)) {
			for (const pos of this.exitCenters[dir]) {
				const exitRoads = this.placementManager.findAccessRoad(pos, this.roomCenterEntrances);
				for (const pos of exitRoads) {
					// Mark exit road locations as roads without actually placing any.
					// This ensures there is always an open path for reaching any exit.
					this.placementManager.planLocation(pos, 'road.exit', 1);
				}
			}
		}

		// Remove stored locations to save memory, they are not needed.
		this.roomPlan.removeAllPositions('road.exit');

		return 'ok';
	}

	placeHarvestBayStructures(): StepResult {
		const roomIntel = getRoomIntel(this.roomName);
		for (const source of roomIntel.getSourcePositions()) {
			const shouldAddSpawn = this.variationInfo.sourcesWithSpawn.includes(source.id);
			const harvestPosition = this.sourceInfo[source.id].harvestPosition;
			const sourceRoads = this.placementManager.findAccessRoad(harvestPosition, this.roomCenterEntrances);
			for (const pos of sourceRoads) {
				this.placementManager.planLocation(pos, 'road', 1);
				this.placementManager.planLocation(pos, 'road.source', null);
				if (shouldAddSpawn) this.protectPosition(pos, 0);
			}

			this.placementManager.planLocation(harvestPosition, 'container.source', null);
			this.placementManager.planLocation(harvestPosition, 'container', null);

			this.placeBayStructures(harvestPosition, {spawn: shouldAddSpawn, source: true});
		}

		return 'ok';
	}

	/**
	 * Places structures that are fixed to the room's center.
	 */
	placeRoomCore(): StepResult {
		// Fill center cross with roads.
		this.placementManager.planLocation(new RoomPosition(this.roomCenter.x - 2, this.roomCenter.y, this.roomName), 'road', 1);
		this.placementManager.planLocation(new RoomPosition(this.roomCenter.x + 2, this.roomCenter.y, this.roomName), 'road', 1);
		this.placementManager.planLocation(new RoomPosition(this.roomCenter.x, this.roomCenter.y - 2, this.roomName), 'road', 1);
		this.placementManager.planLocation(new RoomPosition(this.roomCenter.x, this.roomCenter.y + 2, this.roomName), 'road', 1);
		this.placementManager.planLocation(new RoomPosition(this.roomCenter.x - 1, this.roomCenter.y - 1, this.roomName), 'road', 1);
		this.placementManager.planLocation(new RoomPosition(this.roomCenter.x - 1, this.roomCenter.y + 1, this.roomName), 'road', 1);
		this.placementManager.planLocation(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y - 1, this.roomName), 'road', 1);
		this.placementManager.planLocation(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y + 1, this.roomName), 'road', 1);

		// Mark center buildings for construction.
		this.placementManager.planLocation(new RoomPosition(this.roomCenter.x, this.roomCenter.y + 1, this.roomName), 'storage');
		this.placementManager.planLocation(new RoomPosition(this.roomCenter.x, this.roomCenter.y - 1, this.roomName), 'terminal');
		this.placementManager.planLocation(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y, this.roomName), 'factory');
		this.placementManager.planLocation(new RoomPosition(this.roomCenter.x + 2, this.roomCenter.y - 1, this.roomName), 'lab');
		this.placementManager.planLocation(new RoomPosition(this.roomCenter.x + 2, this.roomCenter.y - 1, this.roomName), 'lab.boost');
		this.placementManager.planLocation(new RoomPosition(this.roomCenter.x - 1, this.roomCenter.y, this.roomName), 'link');
		this.placementManager.planLocation(new RoomPosition(this.roomCenter.x - 1, this.roomCenter.y, this.roomName), 'link.storage');

		return 'ok';
	};

	/**
	 * Places parking spot for helper creep.
	 */
	placeHelperParkingLot(): StepResult {
		this.placementManager.startBuildingPlacement(this.roomCenter, this.roomCenterEntrances);
		const nextPos = this.placementManager.getNextAvailableBuildSpot();
		if (!nextPos) return 'failed';

		this.placementManager.planLocation(nextPos, 'road', 255);
		this.placementManager.planLocation(nextPos, 'helper_parking');

		this.placementManager.placeAccessRoad(nextPos);

		this.placementManager.filterOpenList(encodePosition(nextPos));

		return 'ok';
	};

	/**
	 * Places extension bays.
	 */
	placeBays(): StepResult {
		let count = 0;
		while (this.roomPlan.canPlaceMore('extension')) {
			const pos = this.findBayPosition();
			if (!pos) return 'failed';

			this.placementManager.placeAccessRoad(pos);

			// Make sure there is a road in the center of the bay.
			this.placementManager.planLocation(pos, 'road', 1);
			this.placementManager.planLocation(pos, 'bay_center', 1);

			this.placeBayStructures(pos, {spawn: true, id: count++});

			this.protectPosition(pos);

			// Reinitialize pathfinding.
			this.placementManager.startBuildingPlacement();
		}

		return 'ok';
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

		this.placementManager.startBuildingPlacement(this.roomCenter, this.roomCenterEntrances);

		while (maxExtensions < 8) {
			const nextPos = this.placementManager.getNextAvailableBuildSpot();
			if (!nextPos) break;

			// Don't build too close to exits.
			if (this.placementManager.getExitDistance(nextPos.x, nextPos.y) < 8) continue;

			if (!this.placementManager.isBuildableTile(nextPos.x, nextPos.y)) continue;

			// @todo One tile is allowed to be a road.
			// @todo Use a lenient stamper.
			let tileCount = 0;
			if (this.placementManager.isBuildableTile(nextPos.x - 1, nextPos.y)) tileCount++;
			if (this.placementManager.isBuildableTile(nextPos.x + 1, nextPos.y)) tileCount++;
			if (this.placementManager.isBuildableTile(nextPos.x, nextPos.y - 1)) tileCount++;
			if (this.placementManager.isBuildableTile(nextPos.x, nextPos.y + 1)) tileCount++;
			if (this.placementManager.isBuildableTile(nextPos.x - 1, nextPos.y - 1)) tileCount++;
			if (this.placementManager.isBuildableTile(nextPos.x + 1, nextPos.y - 1)) tileCount++;
			if (this.placementManager.isBuildableTile(nextPos.x - 1, nextPos.y + 1)) tileCount++;
			if (this.placementManager.isBuildableTile(nextPos.x + 1, nextPos.y + 1)) tileCount++;

			if (tileCount <= maxExtensions) continue;

			maxExtensions = tileCount;
			const score = tileCount / (this.placementManager.getCurrentBuildSpotInfo().range + 10);
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
		this.placementManager.startBuildingPlacement();
		while (this.roomPlan.canPlaceMore('lab')) {
			const nextPos = this.placementManager.getNextAvailableBuildSpot();
			if (!nextPos) return 'failed';

			// Don't build too close to exits.
			if (this.placementManager.getExitDistance(nextPos.x, nextPos.y) < 8) continue;

			// @todo Dynamically generate lab layout for servers where 10 labs is not the max.
			// @todo Allow rotating this blueprint for better access.
			// @todo Use stamper.
			if (!this.placementManager.isBuildableTile(nextPos.x, nextPos.y)) continue;
			if (!this.placementManager.isBuildableTile(nextPos.x - 1, nextPos.y)) continue;
			if (!this.placementManager.isBuildableTile(nextPos.x + 1, nextPos.y)) continue;
			if (!this.placementManager.isBuildableTile(nextPos.x, nextPos.y - 1)) continue;
			if (!this.placementManager.isBuildableTile(nextPos.x, nextPos.y + 1)) continue;
			if (!this.placementManager.isBuildableTile(nextPos.x - 1, nextPos.y - 1)) continue;
			if (!this.placementManager.isBuildableTile(nextPos.x + 1, nextPos.y - 1)) continue;
			if (!this.placementManager.isBuildableTile(nextPos.x - 1, nextPos.y + 1)) continue;
			if (!this.placementManager.isBuildableTile(nextPos.x + 1, nextPos.y + 1)) continue;
			if (!this.placementManager.isBuildableTile(nextPos.x - 1, nextPos.y + 2)) continue;
			if (!this.placementManager.isBuildableTile(nextPos.x, nextPos.y + 2)) continue;
			if (!this.placementManager.isBuildableTile(nextPos.x + 1, nextPos.y + 2)) continue;

			// Place center area.
			this.placementManager.planLocation(new RoomPosition(nextPos.x - 1, nextPos.y, nextPos.roomName), 'lab');
			this.placementManager.planLocation(new RoomPosition(nextPos.x - 1, nextPos.y, nextPos.roomName), 'lab.reaction');
			this.placementManager.planLocation(new RoomPosition(nextPos.x, nextPos.y, nextPos.roomName), 'road', 1);

			this.placementManager.planLocation(new RoomPosition(nextPos.x + 1, nextPos.y, nextPos.roomName), 'lab');
			this.placementManager.planLocation(new RoomPosition(nextPos.x + 1, nextPos.y, nextPos.roomName), 'lab.reaction');
			this.placementManager.planLocation(new RoomPosition(nextPos.x - 1, nextPos.y + 1, nextPos.roomName), 'lab');
			this.placementManager.planLocation(new RoomPosition(nextPos.x - 1, nextPos.y + 1, nextPos.roomName), 'lab.reaction');
			this.placementManager.planLocation(new RoomPosition(nextPos.x, nextPos.y + 1, nextPos.roomName), 'road', 1);

			this.placementManager.planLocation(new RoomPosition(nextPos.x + 1, nextPos.y + 1, nextPos.roomName), 'lab');
			this.placementManager.planLocation(new RoomPosition(nextPos.x + 1, nextPos.y + 1, nextPos.roomName), 'lab.reaction');

			this.placementManager.placeAccessRoad(nextPos);

			// Add top and bottom buildings.
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 2; dy += 3) {
					if (this.placementManager.isBuildableTile(nextPos.x + dx, nextPos.y + dy)) {
						this.placementManager.planLocation(new RoomPosition(nextPos.x + dx, nextPos.y + dy, nextPos.roomName), 'lab');
						this.placementManager.planLocation(new RoomPosition(nextPos.x + dx, nextPos.y + dy, nextPos.roomName), 'lab.reaction');
					}
				}
			}

			// Reinitialize pathfinding.
			this.placementManager.startBuildingPlacement();
		}

		return 'ok';
	};

	placeHighLevelStructures(): StepResult {
		this.placementManager.placeAll('powerSpawn', true);
		this.placementManager.placeAll('nuker', true);
		this.placementManager.placeAll('observer', false);

		return 'ok';
	}

	placeRamparts(): StepResult {
		// Make sure the controller can't directly be reached by enemies.
		const roomIntel = getRoomIntel(this.roomName);
		const safety = roomIntel.calculateAdjacentRoomSafety();

		this.protectPosition(roomIntel.getControllerPosition(), 1);

		for (const locationType of this.roomPlan.getPositionTypes()) {
			const baseType = locationType.split('.')[0];
			if (!CONTROLLER_STRUCTURES[baseType] || ['extension', 'road', 'container', 'extractor', 'link'].includes(baseType)) continue;

			// Protect area around essential structures.
			for (const pos of this.roomPlan.getPositions(locationType)) {
				this.protectPosition(pos);
			}
		}

		// Protect exits to safe rooms.
		const bounds: MinCutRect = {x1: 0, x2: 49, y1: 0, y2: 49};
		for (const exitDir of _.keys(safety.directions)) {
			if (!safety.directions[exitDir]) continue;

			if (exitDir === 'N') bounds.protectTopExits = true;
			if (exitDir === 'S') bounds.protectBottomExits = true;
			if (exitDir === 'W') bounds.protectLeftExits = true;
			if (exitDir === 'E') bounds.protectRightExits = true;
		}

		const potentialWallPositions: RoomPosition[] = [];
		const rampartCoords = minCut.getCutTiles(this.roomName, this.minCutBounds, bounds);
		for (const coord of rampartCoords) {
			potentialWallPositions.push(new RoomPosition(coord.x, coord.y, this.roomName));
		}

		this.pruneWalls(potentialWallPositions);

		// Actually place ramparts.
		for (const i in potentialWallPositions) {
			if (potentialWallPositions[i].isRelevant) {
				this.placementManager.planLocation(potentialWallPositions[i], 'rampart', null);
			}
		}

		return 'ok';
	}

	/**
	 * Marks all walls which are adjacent to the "inner area" of the room.
	 *
	 * @param {RoomPosition[]} walls
	 *   Positions where walls are currently planned.
	 */
	pruneWalls(walls: RoomPosition[]) {
		const roomIntel = getRoomIntel(this.roomName);
		const safety = roomIntel.calculateAdjacentRoomSafety();
		const roomCenter = _.first(this.roomPlan.getPositions('center'));
		this.safetyMatrix = new PathFinder.CostMatrix();

		const openList = [];
		openList.push(encodePosition(roomCenter));
		openList.push(encodePosition(roomIntel.getControllerPosition()));
		for (const source of roomIntel.getSourcePositions()) {
			openList.push(encodePosition(new RoomPosition(source.x, source.y, this.roomName)));
		}

		const mineral = roomIntel.getMineralPosition();
		openList.push(encodePosition(new RoomPosition(mineral.x, mineral.y, this.roomName)));

		this.pruneWallFromTiles(walls, openList);

		// Do a second pass, checking which walls get touched by unsafe exits.

		// Prepare CostMatrix and exit points.
		const exits = [];

		for (let i = 0; i < 50; i++) {
			if (this.terrain.get(0, i) !== TERRAIN_MASK_WALL && !safety.directions.W) {
				exits.push(encodePosition(new RoomPosition(0, i, this.roomName)));
			}

			if (this.terrain.get(49, i) !== TERRAIN_MASK_WALL && !safety.directions.E) {
				exits.push(encodePosition(new RoomPosition(49, i, this.roomName)));
			}

			if (this.terrain.get(i, 0) !== TERRAIN_MASK_WALL && !safety.directions.N) {
				exits.push(encodePosition(new RoomPosition(i, 0, this.roomName)));
			}

			if (this.terrain.get(i, 49) !== TERRAIN_MASK_WALL && !safety.directions.S) {
				exits.push(encodePosition(new RoomPosition(i, 49, this.roomName)));
			}
		}

		this.pruneWallFromTiles(walls, exits, true);

		// Safety matrix has been filled, now mark any tiles unsafe that can be reached by a ranged attacker.
		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				// Only check around unsafe tiles.
				if (this.safetyMatrix.get(x, y) !== TILE_IS_UNSAFE) continue;

				this.markTilesInRangeOfUnsafeTile(x, y);
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
		let safetyValue = TILE_IS_SAFE;

		for (const location of startLocations) {
			openList[location] = true;
		}

		// If we're doing an additionall pass, unmark walls first.
		if (onlyRelevant) {
			safetyValue = TILE_IS_UNSAFE;
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
			const nextPos = decodePosition(_.first(_.keys(openList)));

			// Record which tiles are safe or unsafe.
			this.safetyMatrix.set(nextPos.x, nextPos.y, safetyValue);

			delete openList[encodePosition(nextPos)];
			closedList[encodePosition(nextPos)] = true;

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
		handleMapArea(targetPos.x, targetPos.y, (x, y) => {
			if (x === targetPos.x && y === targetPos.y) return;
			if (x < 1 || x > 48 || y < 1 || y > 48) return;

			// Ignore walls.
			if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;

			const posName = encodePosition(new RoomPosition(x, y, this.roomName));
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
	 * Mark tiles that can be reached by ranged creeps outside our walls as unsafe.
	 *
	 * @param {number} x
	 *   x position of the a tile that is unsafe.
	 * @param {number} y
	 *   y position of the a tile that is unsafe.
	 */
	markTilesInRangeOfUnsafeTile(x: number, y: number) {
		handleMapArea(x, y, (ax, ay) => {
			if (this.safetyMatrix.get(ax, ay) === TILE_IS_SAFE) {
				// Safe tile in range of an unsafe tile, mark as neutral.
				this.safetyMatrix.set(ax, ay, TILE_IS_ENDANGERED);
			}
		}, 3);
	}

	/**
	 * Mark all tiles outside safe area as unbuildable.
	 */
	sealRoom(): StepResult {
		for (let x = 1; x < 49; x++) {
			for (let y = 1; y < 49; y++) {
				if (this.safetyMatrix.get(x, y) === TILE_IS_SAFE) continue;
				if (this.safetyMatrix.get(x, y) === TILE_IS_ENDANGERED) continue;

				this.placementManager.blockPosition(x, y);
			}
		}

		return 'ok';
	}

	placeTowers(): StepResult {
		const step = new PlaceTowersStep(this.roomPlan, this.placementManager, this.safetyMatrix);
		return step.run();
	}

	placeOnRamps(): StepResult {
		for (const rampart of this.roomPlan.getPositions('rampart')) {
			handleMapArea(rampart.x, rampart.y, (x, y) => {
				if (this.safetyMatrix.get(x, y) !== TILE_IS_ENDANGERED) return;

				const pos = new RoomPosition(x, y, this.roomName);
				if (!this.roomPlan.hasPosition('road', pos)) return;

				this.placementManager.planLocation(pos, 'rampart', null);
				this.placementManager.planLocation(pos, 'rampart.ramp', null);
			}, 3);
		}

		return 'ok';
	}

	placeQuadBreaker(): StepResult {
		for (const rampart of this.roomPlan.getPositions('rampart')) {
			handleMapArea(rampart.x, rampart.y, (x, y) => {
				if (this.safetyMatrix.get(x, y) !== TILE_IS_UNSAFE) return;

				this.safetyMatrix.set(x, y, TILE_IS_UNSAFE_NEAR_WALL);
				if (this.placementManager.getExitDistance(x, y) < 3) return;

				const pos = new RoomPosition(x, y, this.roomName);
				if (this.roomPlan.hasPosition('road', pos)) return;

				let nearRoad = false;
				if (this.roomPlan.hasPosition('road', new RoomPosition(x - 1, y, this.roomName))) nearRoad = true;
				if (this.roomPlan.hasPosition('road', new RoomPosition(x + 1, y, this.roomName))) nearRoad = true;
				if (this.roomPlan.hasPosition('road', new RoomPosition(x, y - 1, this.roomName))) nearRoad = true;
				if (this.roomPlan.hasPosition('road', new RoomPosition(x, y + 1, this.roomName))) nearRoad = true;

				if (!nearRoad && (x + y) % 2 === 0) return;

				this.placementManager.planLocation(pos, 'wall', null);
				this.placementManager.planLocation(pos, 'wall.quad', null);
			}, 3);
		}

		return 'ok';
	}

	isFinished(): boolean {
		return this.finished;
	}
}
