import hivemind from 'hivemind';
import minCut from 'utils/mincut';
import PlaceTowersStep from 'room/planner/step/place-towers';
import RoomVariationBuilderBase from 'room/planner/variation-builder-base';
import settings from 'settings-manager';
import {encodePosition, decodePosition} from 'utils/serialization';
import {getExitCenters} from 'utils/room-info';
import {getRoomIntel} from 'room-intel';
import {handleMapArea} from 'utils/map';
import type {ExitCoords} from 'utils/room-info';

const TILE_IS_ENDANGERED = 0;
const TILE_IS_SAFE = 1;
const TILE_IS_UNSAFE = 2;
const TILE_IS_UNSAFE_NEAR_WALL = 3;

const decorativeWallPattern = [
	[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	[0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1],
	[0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0],
	[0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
	[0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
	[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
	[0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
	[0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
	[0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0],
	[0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1],
];

export default class RoomVariationBuilder extends RoomVariationBuilderBase {
	exitCenters: ExitCoords;
	roomCenter: RoomPosition;
	roomCenterEntrances: RoomPosition[];
	safetyMatrix: CostMatrix;

	protected sourceInfo: Record<string, {
		harvestPosition: RoomPosition;
	}>;

	protected steps: Array<() => StepResult>;

	constructor(roomName: string, variation: string, protected variationInfo: VariationInfo, wallMatrix: CostMatrix, exitMatrix: CostMatrix) {
		super(roomName, variation, wallMatrix, exitMatrix);
		hivemind.log('rooms', this.roomName).info('Started generating room plan for variation', variation);

		this.steps = [
			this.gatherExitCoords,
			this.determineCorePosition,
			this.determineHarvesterPositions,
			this.determineUpgraderPosition,
			this.placeRoadNetwork,
			this.placeRoomCore,
			this.placeHarvestBayStructures,
			this.placeHelperParkingLot,
			this.placeLabs,
			this.placeBays,
			this.placeHighLevelStructures,
			this.placeRamparts,
			this.placeQuadBreaker,
			this.placeDecorativeWalls,
			this.sealRoom,
			this.placeTowers,
			this.placeRoadsToRamps,
			this.placeOnRamps,
		];
	}

	buildStep(step: number): StepResult {
		if (step < this.steps.length) {
			const method = this.steps[step];

			return method.call(this);
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

		for (const mineral of roomIntel.getMineralPositions()) {
			const mineralPosition = new RoomPosition(mineral.x, mineral.y, this.roomName);
			this.placementManager.planLocation(mineralPosition, 'extractor');
			const mineralRoads = this.placementManager.findAccessRoad(mineralPosition, this.roomCenterEntrances);
			for (const pos of mineralRoads) {
				this.placementManager.planLocation(pos, 'road', 1);
				this.placementManager.planLocation(pos, 'road.mineral', null);
			}

			this.placeContainer(mineralRoads, 'mineral');

			this.storeHarvestPosition(mineral, mineralRoads[0]);
		}

		return 'ok';
	}

	determineHarvestPositionForSource(source: {x: number; y: number}): RoomPosition {
		// Find adjacent space that will provide most building space.
		// @todo Reasonably handle sources that can be accessed from multiple
		// sides. For example by checking if theres more than 1 group of
		// unconnected free tiles.
		let bestPos: {x: number; y: number; freeTileCount: number} = null;
		handleMapArea(source.x, source.y, (x, y) => {
			if (!this.placementManager.isBuildableTile(x, y)) return;

			let freeTileCount = 0;
			handleMapArea(x, y, (x2, y2) => {
				if (!this.placementManager.isBuildableTile(x2, y2)) return;

				freeTileCount++;
			});

			if (!bestPos || bestPos.freeTileCount < freeTileCount) {
				bestPos = {x, y, freeTileCount};
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
		this.protectPosition(controllerPosition, 1);

		const controllerRoads = this.findBestControllerRoad(controllerPosition);
		for (const pos of controllerRoads) {
			this.protectPosition(pos, 0);
			if (pos.getRangeTo(controllerRoads[0]) === 0) continue;

			this.placementManager.planLocation(pos, 'road', 1);
			this.placementManager.planLocation(pos, 'road.controller', null);
		}

		// Store position where main upgrader can stay and upgrade.
		this.placementManager.planLocation(controllerRoads[0], 'upgrader.0', 1);
		this.protectPosition(controllerRoads[0], 1);

		const containerPosition = this.placeContainer(controllerRoads, 'controller');
		this.placementManager.planLocation(containerPosition, 'road', null);
		this.placementManager.planLocation(containerPosition, 'road.controller', null);

		// Place a link near controller, but off the calculated path.
		this.placeControllerLink(controllerRoads[0], controllerPosition);

		// Place roads on swamp tiles surrounding the container so upgraders
		// don't navigate away from it.
		handleMapArea(containerPosition.x, containerPosition.y, (x, y) => {
			if (!this.placementManager.isBuildableTile(x, y, false, true)) return;
			if (this.terrain.get(x, y) !== TERRAIN_MASK_SWAMP) return;

			const position = new RoomPosition(x, y, this.roomName);
			this.placementManager.planLocation(position, 'road', 1);
			this.placementManager.planLocation(position, 'road.controller', null);
		});

		// Make sure no other paths get led through upgrader position.
		this.placementManager.blockPosition(controllerRoads[0].x, controllerRoads[0].y);

		return 'ok';
	}

	findBestControllerRoad(controllerPosition: RoomPosition): RoomPosition[] {
		let best: {
			path: RoomPosition[];
			score: number;
		};
		handleMapArea(controllerPosition.x, controllerPosition.y, (x, y) => {
			if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;

			const availableSpots = this.getAvailableUpgraderSpotCount(x, y, controllerPosition);
			if (availableSpots < 3) return;

			const startPosition = new RoomPosition(x, y, this.roomName);
			const path = this.placementManager.findAccessRoad(startPosition, this.roomCenterEntrances);
			path.splice(0, 0, startPosition);

			const score = path.length - (availableSpots * 1.1);
			if (!best || best.score > score) best = {path, score};
		}, 3);

		return best?.path;
	}

	getAvailableUpgraderSpotCount(x: number, y: number, controllerPosition: RoomPosition): number {
		// We want at least 3 spots for upgraders that can reach the controller.
		let validSpots = 0;
		handleMapArea(x, y, (x2, y2) => {
			if (this.terrain.get(x2, y2) === TERRAIN_MASK_WALL) return;
			if (controllerPosition.getRangeTo(x2, y2) > 3) return;

			validSpots++;
		});

		return validSpots;
	}

	/**
	 * Places the controller link near the main upgrade position.
	 */
	placeControllerLink(upgradePosition: RoomPosition, controllerPosition: RoomPosition) {
		const targetPos = this.findControllerLinkPosition(upgradePosition, controllerPosition);

		if (!targetPos) return;

		this.placementManager.planLocation(targetPos, 'link.controller', null);
		this.placementManager.planLocation(targetPos, 'link');
		this.protectPosition(targetPos, 0);
	}

	/**
	 * Finds the best spot for a controller link near the main upgrade position.
	 */
	findControllerLinkPosition(upgradePosition: RoomPosition, controllerPosition: RoomPosition): RoomPosition {
		let best: {
			pos: RoomPosition;
			score: number;
		};
		handleMapArea(upgradePosition.x, upgradePosition.y, (x, y) => {
			if (!this.placementManager.isBuildableTile(x, y, false, true)) return;

			let score = this.getAvailableUpgraderSpotCount(x, y, controllerPosition) - 1;

			// If multiple positions give the same amount of upgrader positions,
			// prefer one that doesn't block the controller. That also gives us
			// 1 extra spot to upgrade from.
			if (controllerPosition.getRangeTo(x, y) > 3) score += 1.5;

			if (!best || best.score < score) best = {pos: new RoomPosition(x, y, upgradePosition.roomName), score};
		});

		return best.pos;
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
		this.placementManager.planLocation(new RoomPosition(this.roomCenter.x - 1, this.roomCenter.y, this.roomName), 'link');
		this.placementManager.planLocation(new RoomPosition(this.roomCenter.x - 1, this.roomCenter.y, this.roomName), 'link.storage');

		return 'ok';
	}

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
	}

	/**
	 * Places extension bays.
	 */
	placeBays(): StepResult {
		this.placementManager.startBuildingPlacement();
		let count = 0;
		while (this.roomPlan.canPlaceMore('extension')) {
			const pos = this.findBayPosition();
			if (!pos) return 'failed';

			this.placementManager.placeAccessRoad(pos);

			this.placementManager.planLocation(pos, 'bay_center', 1);

			this.placeBayStructures(pos, {spawn: true, id: count++});

			this.protectPosition(pos);

			// Reinitialize pathfinding.
			this.placementManager.startBuildingPlacement();
		}

		return 'ok';
	}

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
	}

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

			const {x, y, roomName} = nextPos;

			for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
				const availableTiles = [
					[x - dx, y + dy],
					[x - dx, y],
					[x - dx, y - dy],
					[x, y - dy],
					[x + dx, y - dy],
					[x, y + (2 * dy)],
					[x + dx, y + (2 * dy)],
					[x + (2 * dx), y + (2 * dy)],
					[x + (2 * dx), y + dy],
					[x + (2 * dx), y],
				];
				if (!this.canFitLabStamp(nextPos, dx, dy, availableTiles)) continue;

				// Place center area.
				this.placementManager.planLocation(new RoomPosition(x, y, roomName), 'road', 1);
				this.placementManager.planLocation(new RoomPosition(x + dx, y, roomName), 'lab');
				this.placementManager.planLocation(new RoomPosition(x + dx, y, roomName), 'lab.reaction');
				this.placementManager.planLocation(new RoomPosition(x, y + dy, roomName), 'lab');
				this.placementManager.planLocation(new RoomPosition(x, y + dy, roomName), 'lab.reaction');
				this.placementManager.planLocation(new RoomPosition(x + dx, y + dy, roomName), 'road', 1);

				this.placementManager.placeAccessRoad(nextPos);

				// Place succounding labs where there is space.
				for (const [lx, ly] of availableTiles) {
					if (!this.roomPlan.canPlaceMore('lab')) break;
					if (!this.placementManager.isBuildableTile(lx, ly)) continue;

					this.placementManager.planLocation(new RoomPosition(lx, ly, roomName), 'lab');
					this.placementManager.planLocation(new RoomPosition(lx, ly, roomName), 'lab.reaction');
				}

				break;
			}
		}

		// Reinitialize pathfinding.
		this.placementManager.startBuildingPlacement();

		return 'ok';
	}

	canFitLabStamp(pos: RoomPosition, dx: number, dy: number, availableTiles: number[][]): boolean {
		// This stamp can fit 1 more lab than necessary.
		//  ooo
		// oo.o
		// o.oo
		// .oo

		// Center 4 tiles need to always be free, for 2 labs and 2 roads.
		if (!this.placementManager.isBuildableTile(pos.x, pos.y)) return false;
		if (!this.placementManager.isBuildableTile(pos.x + dx, pos.y)) return false;
		if (!this.placementManager.isBuildableTile(pos.x, pos.y + dy)) return false;
		if (!this.placementManager.isBuildableTile(pos.x + dx, pos.y + dy)) return false;

		// We need at least 9 surrounding spots to be available (8 labs + 1 road).
		let freeTiles = 0;
		for (const [x, y] of availableTiles) {
			if (this.placementManager.isBuildableTile(x, y)) freeTiles++;
		}

		return freeTiles > 8;
	}

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
		for (const wallPosition of potentialWallPositions) {
			if (!wallPosition.isRelevant) continue;
			if (this.terrain.get(wallPosition.x, wallPosition.y) === TERRAIN_MASK_WALL) continue;

			this.placementManager.planLocation(wallPosition, 'rampart', null);
			if (settings.get('constructRoadsUnderRamparts') || this.terrain.get(wallPosition.x, wallPosition.y) === TERRAIN_MASK_SWAMP) {
				this.placementManager.planLocation(wallPosition, 'road', null);
				this.placementManager.planLocation(wallPosition, 'road.rampart', null);
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
		openList.push(encodePosition(roomCenter), encodePosition(roomIntel.getControllerPosition()));
		for (const source of roomIntel.getSourcePositions()) {
			openList.push(encodePosition(new RoomPosition(source.x, source.y, this.roomName)));
		}

		for (const mineral of roomIntel.getMineralPositions()) {
			openList.push(encodePosition(new RoomPosition(mineral.x, mineral.y, this.roomName)));
		}

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
	}

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
		const openList: Record<string, boolean> = {};
		const closedList: Record<string, boolean> = {};
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
	}

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
	checkForAdjacentWallsToPrune(targetPos: RoomPosition, walls: RoomPosition[], openList: Record<string, boolean>, closedList: Record<string, boolean>) {
		// Add unhandled adjacent tiles to open list.
		handleMapArea(targetPos.x, targetPos.y, (x, y) => {
			if (x === targetPos.x && y === targetPos.y) return;
			if (x < 1 || x > 48 || y < 1 || y > 48) return;

			// Ignore walls.
			if (this.terrain.get(x, y) === TERRAIN_MASK_WALL && !this.roomPlan.hasPosition('road', new RoomPosition(x, y, this.roomName))) return;

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
	}

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
				if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) {
					this.placementManager.blockPosition(x, y);
					continue;
				}

				if (this.safetyMatrix.get(x, y) === TILE_IS_SAFE) {
					// Record safe status in room plan.
					this.placementManager.planLocation(new RoomPosition(x, y, this.roomName), 'safe', null);
					continue;
				}

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

	placeRoadsToRamps(): StepResult {
		for (const rampartGroup of this.getRampartGroups()) {
			const roads = this.placementManager.findAccessRoad(this.roomCenterEntrances[0], rampartGroup, true);

			for (const road of roads) {
				if (this.roomPlan.hasPosition('extension', road)) {
					this.roomPlan.removePosition('extension', road);
					this.roomPlan.removePosition('extension.bay', road);
					for (let i = 0; i < 10; i++) {
						this.roomPlan.removePosition(`extension.bay.${i}`, road);
					}

					this.placementManager.unblockPosition(road.x, road.y);
				}

				if (settings.get('constructRoadsUnderRamparts')) {
					this.placementManager.planLocation(road, 'road', 1);
				}
				else {
					this.placementManager.planLocation(road, 'road.toRampart', 1);
				}
			}
		}

		return 'ok';
	}

	getRampartGroups(): RoomPosition[][] {
		const allRamparts = _.map(this.roomPlan.getPositions('rampart'), pos => ({
			pos,
			isUsed: false,
		}));

		const rampartGroups: RoomPosition[][] = [];
		for (const rampart of allRamparts) {
			if (rampart.isUsed) continue;

			rampart.isUsed = true;
			const currentGroup = [rampart.pos];
			let rampartAdded = false;
			do {
				rampartAdded = false;
				for (const otherRampart of allRamparts) {
					if (otherRampart.isUsed) continue;

					for (const currentRampart of currentGroup) {
						if (currentRampart.getRangeTo(otherRampart) !== 1) continue;

						otherRampart.isUsed = true;
						currentGroup.push(otherRampart.pos);
						rampartAdded = true;
						break;
					}
				}
			} while (rampartAdded);

			rampartGroups.push(currentGroup);
		}

		return rampartGroups;
	}

	placeOnRamps(): StepResult {
		for (const rampart of this.roomPlan.getPositions('rampart')) {
			this.placeOnRampsAround(rampart);
		}

		return 'ok';
	}

	placeOnRampsAround(rampart: RoomPosition) {
		handleMapArea(rampart.x, rampart.y, (x, y) => {
			if (this.safetyMatrix.get(x, y) !== TILE_IS_ENDANGERED) return;
			if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;

			const pos = new RoomPosition(x, y, this.roomName);
			if (
				!this.roomPlan.hasPosition('road', pos)
				&& !this.roomPlan.hasPosition('road.toRampart', pos)
			) return;
			if (this.roomPlan.hasPosition('rampart', pos)) return;

			this.placementManager.planLocation(pos, 'rampart', null);
			this.placementManager.planLocation(pos, 'rampart.ramp', null);
		}, 3);
	}

	placeQuadBreaker(): StepResult {
		for (const rampart of this.roomPlan.getPositions('rampart')) {
			this.placeQuadBreakerAround(rampart);
		}

		return 'ok';
	}

	placeQuadBreakerAround(rampart: RoomPosition) {
		handleMapArea(rampart.x, rampart.y, (x, y) => {
			if (this.safetyMatrix.get(x, y) !== TILE_IS_UNSAFE) return;
			if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;

			this.safetyMatrix.set(x, y, TILE_IS_UNSAFE_NEAR_WALL);
			if (this.placementManager.getExitDistance(x, y) < 3) return;
			if (this.placementManager.isBlockedTile(x, y)) return;

			const pos = new RoomPosition(x, y, this.roomName);
			if (this.roomPlan.hasPosition('road', pos)) return;

			let nearRoad = false;
			if (
				this.roomPlan.hasPosition('road', new RoomPosition(x - 1, y, this.roomName))
				&& !this.roomPlan.hasPosition('road.rampart', new RoomPosition(x - 1, y, this.roomName))
			) nearRoad = true;
			if (
				this.roomPlan.hasPosition('road', new RoomPosition(x + 1, y, this.roomName))
				&& !this.roomPlan.hasPosition('road.rampart', new RoomPosition(x + 1, y, this.roomName))
			) nearRoad = true;
			if (
				this.roomPlan.hasPosition('road', new RoomPosition(x, y - 1, this.roomName))
				&& !this.roomPlan.hasPosition('road.rampart', new RoomPosition(x, y - 1, this.roomName))
			) nearRoad = true;
			if (
				this.roomPlan.hasPosition('road', new RoomPosition(x, y + 1, this.roomName))
				&& !this.roomPlan.hasPosition('road.rampart', new RoomPosition(x, y + 1, this.roomName))
			) nearRoad = true;

			if (!nearRoad && (x + y) % 2 === 0) return;

			this.placementManager.planLocation(pos, 'wall', null);
			this.placementManager.planLocation(pos, 'wall.quad', null);
		}, 3);
	}

	placeDecorativeWalls(): StepResult {
		const patternHeight = decorativeWallPattern.length;
		const patternWidth = decorativeWallPattern[0].length;

		for (let x = 1; x < 49; x++) {
			for (let y = 1; y < 49; y++) {
				if (!decorativeWallPattern[y % patternHeight][x % patternWidth]) continue;
				if (this.safetyMatrix.get(x, y) !== TILE_IS_UNSAFE) continue;
				if (this.placementManager.getExitDistance(x, y) < 3) continue;
				if (this.placementManager.isBlockedTile(x, y)) continue;

				const position = new RoomPosition(x, y, this.roomName);
				if (this.roomPlan.hasPosition('road', position)) continue;

				this.placementManager.planLocation(position, 'wall', null);
				this.placementManager.planLocation(position, 'wall.deco', null);
			}
		}

		return 'ok';
	}

	isFinished(): boolean {
		return this.finished;
	}
}
