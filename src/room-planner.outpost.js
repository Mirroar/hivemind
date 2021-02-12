'use strict';

/* global */

const RoomPlanner = require('./room-planner');
const CORE_SIZE = 7;

module.exports = class OutpostRoomPlanner extends RoomPlanner {
	constructor(roomName) {
		super(roomName);

		this.roomPlannerVersion = 1;

		if (!Memory.rooms[roomName].outpostRoomPlanner) {
			Memory.rooms[roomName].outpostRoomPlanner = {};
		}

		this.memory = Memory.rooms[roomName].outpostRoomPlanner;

		this.drawDebug();
	}


	// @todo Remove. Only included to get around CPU limits.
	runLogic() {
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
			this.placeFlags();
			this.memory.planningTries++;

			return;
		}

		if (this.memory.lastRun && Game.time - this.memory.lastRun < 100 * hivemind.getThrottleMultiplier()) return;

		this.memory.lastRun = Game.time;

		// Prune old planning cost matrixes. They will be regenerated if needed.
		delete this.memory.wallDistanceMatrix;
		delete this.memory.exitDistanceMatrix;

		this.checkAdjacentRooms();
	};


	drawDebug() {
		super.drawDebug();

		const visual = new RoomVisual(this.roomName);
		_.each(this.memory.cores, core => {
			visual.rect(core.center.x - (CORE_SIZE / 2), core.center.y - (CORE_SIZE / 2), CORE_SIZE, CORE_SIZE, {fill: 'transparent', stroke: '#f00'});
		});
	}

	placeFlags() {
		const start = Game.cpu.getUsed();

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

		this.findCorePositions();
	}

	findCorePositions() {
		this.memory.cores = [];
		const intel = hivemind.roomIntel(this.roomName);
		const controllerPosition = intel.getControllerPosition();

		const controllerCore = _.first(_.sortBy(this.collectCorePositions(controllerPosition.x - 1, controllerPosition.y - 1, controllerPosition.x + 1, controllerPosition.y + 1), '-score'));
		this.memory.cores.push(controllerCore);
	}

	collectCorePositions(maxLeft, maxTop, minRight, minBottom) {
		const positions = [];
		const terrain = new Room.Terrain(this.roomName);

		for (let left = minRight - CORE_SIZE + 1; left <= maxLeft; left++) {
			if (left < 3) continue;
			if (left + CORE_SIZE > 48) continue;

			for (let top = minBottom - CORE_SIZE + 1; top <= maxTop; top++) {
				if (top < 3) continue;
				if (top + CORE_SIZE > 48) continue;

				// Check if 3x3 core center is free.
				if (terrain.get(-1 + left + (CORE_SIZE - 1) / 2, -1 + top + (CORE_SIZE - 1) / 2) === TERRAIN_MASK_WALL) continue;
				if (terrain.get(     left + (CORE_SIZE - 1) / 2, -1 + top + (CORE_SIZE - 1) / 2) === TERRAIN_MASK_WALL) continue;
				if (terrain.get( 1 + left + (CORE_SIZE - 1) / 2, -1 + top + (CORE_SIZE - 1) / 2) === TERRAIN_MASK_WALL) continue;
				if (terrain.get(-1 + left + (CORE_SIZE - 1) / 2,      top + (CORE_SIZE - 1) / 2) === TERRAIN_MASK_WALL) continue;
				if (terrain.get(     left + (CORE_SIZE - 1) / 2,      top + (CORE_SIZE - 1) / 2) === TERRAIN_MASK_WALL) continue;
				if (terrain.get( 1 + left + (CORE_SIZE - 1) / 2,      top + (CORE_SIZE - 1) / 2) === TERRAIN_MASK_WALL) continue;
				if (terrain.get(-1 + left + (CORE_SIZE - 1) / 2,  1 + top + (CORE_SIZE - 1) / 2) === TERRAIN_MASK_WALL) continue;
				if (terrain.get(     left + (CORE_SIZE - 1) / 2,  1 + top + (CORE_SIZE - 1) / 2) === TERRAIN_MASK_WALL) continue;
				if (terrain.get( 1 + left + (CORE_SIZE - 1) / 2,  1 + top + (CORE_SIZE - 1) / 2) === TERRAIN_MASK_WALL) continue;

				// Count free tiles.
				// @todo This can be optimized.
				let freeTiles = 0;
				for (let x = left; x < left + CORE_SIZE; x++) {
					for (let y = top; y < top + CORE_SIZE; y++) {
						if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
							freeTiles++;
						}
					}
				}

				positions.push({
					center: {
						x: left + (CORE_SIZE - 1) / 2,
						y: top + (CORE_SIZE - 1) / 2,
					},
					score: freeTiles,
				});
			}
		}

		return positions;
	}
};
