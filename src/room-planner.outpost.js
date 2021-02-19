'use strict';

/* global hivemind Room RoomPosition RoomVisual PathFinder TERRAIN_MASK_WALL */

const utilities = require('./utilities');
const RoomPlanner = require('./room-planner');
const CORE_SIZE = 7;
const CORE_RADIUS = (CORE_SIZE - 1) / 2;

module.exports = class OutpostRoomPlanner extends RoomPlanner {
	constructor(roomName) {
		super(roomName);

		this.roomPlannerVersion = 13;

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
	}

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
		this.terrain = new Room.Terrain(this.roomName);

		this.findCorePositions();

		for (const core of this.memory.cores) {
			this.initCoreCenter(core);
			this.initBuildLocations(core);
			this.placeRamparts(core);
		}
	}

	/**
	 * Tries to find optimal positions for placing the room's cores.
	 *
	 * @todo We probably shouldn't move cores that have already been built.
	 * @todo Make sure cores overlap as little as possible.
	 * @todo Consider placing cores elsewhere to maximize build space and/or
	 * minimize ramparts. wallDistanceMatrix might be useful for this:
	 * When wallDistanceMatrix value is >= 4, we can place a full core.
	 */
	findCorePositions() {
		this.memory.cores = [];
		const intel = hivemind.roomIntel(this.roomName);

		const controllerPosition = intel.getControllerPosition();
		const adjacent = this.findAdjacentFreeTiles(controllerPosition);
		adjacent.push(controllerPosition);

		const xValues = _.pluck(adjacent, 'x');
		const yValues = _.pluck(adjacent, 'y');
		const controllerCore = _.first(_.sortByOrder(this.collectCorePositions(_.min(xValues), _.min(yValues), _.max(xValues), _.max(yValues)), 'score', 'desc'));
		controllerCore.type = 'controller';
		this.memory.cores.push(controllerCore);

		_.each(intel.getSourcePositions(), source => {
			const adjacent = this.findAdjacentFreeTiles(new RoomPosition(source.x, source.y, this.roomName));

			const xValues = _.pluck(adjacent, 'x');
			const yValues = _.pluck(adjacent, 'y');
			const sourceCore = _.first(_.sortByOrder(this.collectCorePositions(_.max(xValues), _.max(yValues), _.min(xValues), _.min(yValues)), 'score', 'desc'));
			sourceCore.type = 'source';
			sourceCore.sourceId = source.id;

			for (const core of sourceCore.adjustedCores) {
				core.core.ramparts = core.ramparts;
				core.core.numRamparts = core.numRamparts;
				// @todo Adjust score.
			}

			this.memory.cores.push(sourceCore);
		});

		// @todo On one-source rooms, the third core may be placed near minerals.
	}

	/**
	 * Tries to find optimal core position overlapping/touching an area.
	 */
	collectCorePositions(maxLeft, maxTop, minRight, minBottom) {
		const positions = [];

		for (let left = minRight - CORE_SIZE + 1; left <= maxLeft; left++) {
			if (left < 2) continue;
			if (left + CORE_SIZE > 49) continue;

			for (let top = minBottom - CORE_SIZE + 1; top <= maxTop; top++) {
				if (top < 2) continue;
				if (top + CORE_SIZE > 49) continue;

				// Check if 3x3 core center is free.
				if (this.terrain.get(-1 + left + CORE_RADIUS, -1 + top + CORE_RADIUS) === TERRAIN_MASK_WALL) continue;
				if (this.terrain.get(     left + CORE_RADIUS, -1 + top + CORE_RADIUS) === TERRAIN_MASK_WALL) continue;
				if (this.terrain.get( 1 + left + CORE_RADIUS, -1 + top + CORE_RADIUS) === TERRAIN_MASK_WALL) continue;
				if (this.terrain.get(-1 + left + CORE_RADIUS,      top + CORE_RADIUS) === TERRAIN_MASK_WALL) continue;
				if (this.terrain.get(     left + CORE_RADIUS,      top + CORE_RADIUS) === TERRAIN_MASK_WALL) continue;
				if (this.terrain.get( 1 + left + CORE_RADIUS,      top + CORE_RADIUS) === TERRAIN_MASK_WALL) continue;
				if (this.terrain.get(-1 + left + CORE_RADIUS,  1 + top + CORE_RADIUS) === TERRAIN_MASK_WALL) continue;
				if (this.terrain.get(     left + CORE_RADIUS,  1 + top + CORE_RADIUS) === TERRAIN_MASK_WALL) continue;
				if (this.terrain.get( 1 + left + CORE_RADIUS,  1 + top + CORE_RADIUS) === TERRAIN_MASK_WALL) continue;

				// Count free tiles.
				// @todo This can be optimized.
				let freeTiles = 0;
				for (let x = left; x < left + CORE_SIZE; x++) {
					for (let y = top; y < top + CORE_SIZE; y++) {
						if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

						// Check overlap with other cores.
						let overlap = false;
						for (const core of this.memory.cores) {
							if (Math.max(Math.abs(x - core.center.x), Math.abs(y - core.center.y)) > CORE_RADIUS) continue;

							overlap = true;
							break;
						}

						if (overlap) continue;

						freeTiles++;
					}
				}

				// Count necessary ramparts.
				// @todo Skip if free tiles already rule out a max score.
				const ramparts = [];
				for (let x = 0; x < CORE_SIZE; x++) {
					ramparts[x] = [];
					for (let y = 0; y < CORE_SIZE; y++) {
						ramparts[x][y] = this.terrain.get(left + x, top + y) === TERRAIN_MASK_WALL ? -1 : 0;
					}
				}

				this._coreLeft = left;
				this._coreTop = top;
				this._numRamparts = 0;
				for (let x = left - 1; x <= left + CORE_SIZE; x++) {
					this.markRamparts(ramparts, x, top - 1);
					this.markRamparts(ramparts, x, top + CORE_SIZE);
				}
				for (let y = top; y < top + CORE_SIZE; y++) {
					this.markRamparts(ramparts, left - 1, y);
					this.markRamparts(ramparts, left + CORE_SIZE, y);
				}
				// @todo recalculate ramparts for other cores we touch and let it
				// influence score.
				// @todo unless we create new dead ends, in which case other cores
				// might be affected as well.
				const adjustedCores = [];
				let savedRamparts = 0;
				for (const core of this.memory.cores) {
					if (
						Math.max(
							Math.abs(left + (CORE_RADIUS) - core.center.x),
							Math.abs(top + (CORE_RADIUS) - core.center.y)
						) > CORE_SIZE
					) continue;

					const coreRamparts = [];
					this._otherNumRamparts = 0;
					for (let x = 0; x < CORE_SIZE; x++) {
						coreRamparts[x] = [];
						for (let y = 0; y < CORE_SIZE; y++) {
							coreRamparts[x][y] = this.terrain.get(x + core.center.x - CORE_RADIUS, y + core.center.y - CORE_RADIUS) === TERRAIN_MASK_WALL ? -1 : 0;
						}
					}

					for (let x = core.center.x - CORE_RADIUS - 1; x <= core.center.x + CORE_RADIUS + 1; x++) {
						this.markRamparts(coreRamparts, x, core.center.y - CORE_RADIUS - 1, core);
						this.markRamparts(coreRamparts, x, core.center.y + CORE_RADIUS + 1, core);
					}
					for (let y = core.center.y - CORE_RADIUS - 1; y < core.center.y + CORE_RADIUS + 1; y++) {
						this.markRamparts(coreRamparts, core.center.x - CORE_RADIUS - 1, y, core);
						this.markRamparts(coreRamparts, core.center.x + CORE_RADIUS + 1, y, core);
					}

					if (this._otherNumRamparts >= core.numRamparts) continue;

					adjustedCores.push({
						core,
						numRamparts: this._otherNumRamparts,
						ramparts: coreRamparts,
					});
					savedRamparts += core.numRamparts - this._otherNumRamparts;
				}

				positions.push({
					center: {
						x: left + CORE_RADIUS,
						y: top + CORE_RADIUS,
					},
					ramparts,
					numRamparts: this._numRamparts,
					adjustedCores,
					score: freeTiles + (savedRamparts - this._numRamparts) / 10,
				});
			}
		}

		return positions;
	}

	findAdjacentFreeTiles(center) {
		const tiles = [];
		for (let x = center.x - 1; x <= center.x + 1; x++) {
			for (let y = center.y - 1; y <= center.y + 1; y++) {
				if (this.terrain.get(x, y) !== TERRAIN_MASK_WALL) {
					tiles.push(new RoomPosition(x, y, center.roomName));
				}
			}
		}

		return tiles;
	}

	markRamparts(ramparts, x, y, otherCore) {
		// Check if an enemy could stand on the given tile.
		// @todo Count tiles as safe if they're in a dead end when the core
		// is placed.

		// Enemies can't stand on walls.
		if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;

		// Enemies shouldn't be within another of our cores.
		for (const core of this.memory.cores) {
			if (otherCore && core.center.x === otherCore.center.x && core.center.y === otherCore.center.y) continue;
			if (Math.max(Math.abs(x - core.center.x), Math.abs(y - core.center.y)) <= CORE_RADIUS) return;
		}

		// Or within the core we're currently generating.
		if (otherCore) {
			if (
				x >= this._coreLeft &&
				y >= this._coreTop &&
				x < this._coreLeft + CORE_SIZE &&
				y < this._coreTop + CORE_SIZE
			) return;
		}

		let left = Math.max(x - 3, this._coreLeft) - this._coreLeft;
		let right = Math.min(x + 3, this._coreLeft + CORE_SIZE - 1) - this._coreLeft;
		let top = Math.max(y - 3, this._coreTop) - this._coreTop;
		let bottom = Math.min(y + 3, this._coreTop + CORE_SIZE - 1) - this._coreTop;
		if (otherCore) {
			left = Math.max(x - 3, otherCore.center.x - CORE_RADIUS) - otherCore.center.x + CORE_RADIUS;
			right = Math.min(x + 3, otherCore.center.x + CORE_RADIUS) - otherCore.center.x + CORE_RADIUS;
			top = Math.max(y - 3, otherCore.center.y - CORE_RADIUS) - otherCore.center.y + CORE_RADIUS;
			bottom = Math.min(y + 3, otherCore.center.y + CORE_RADIUS) - otherCore.center.y + CORE_RADIUS;
		}
		for (let rX = left; rX <= right; rX++) {
			for (let rY = top; rY <= bottom; rY++) {
				if (ramparts[rX][rY]) continue;

				ramparts[rX][rY] = 1;
				if (otherCore) {
					this._otherNumRamparts++;
				}
				else {
					this._numRamparts++;
				}
			}
		}
	}

	initCoreCenter(core) {
		this.placeFlag(new RoomPosition(core.center.x - 1, core.center.y, this.roomName), 'road');
		this.placeFlag(new RoomPosition(core.center.x, core.center.y - 1, this.roomName), 'road');
		this.placeFlag(new RoomPosition(core.center.x + 1, core.center.y, this.roomName), 'road');
		this.placeFlag(new RoomPosition(core.center.x, core.center.y + 1, this.roomName), 'road');

		this.placeFlag(new RoomPosition(core.center.x + 1, core.center.y - 1, this.roomName), 'spawn');
		if (core.type === 'controller') {
			this.placeFlag(new RoomPosition(core.center.x - 1, core.center.y - 1, this.roomName), 'storage');
			this.placeFlag(new RoomPosition(core.center.x + 1, core.center.y + 1, this.roomName), 'terminal');
			this.placeFlag(new RoomPosition(core.center.x - 1, core.center.y + 1, this.roomName), 'link');
		}
		else {
			this.placeFlag(new RoomPosition(core.center.x, core.center.y, this.roomName), 'container');
			this.placeFlag(new RoomPosition(core.center.x + 1, core.center.y + 1, this.roomName), 'link');
			this.placeFlag(new RoomPosition(core.center.x - 1, core.center.y + 1, this.roomName), 'link');
		}
	}

	initBuildLocations(core) {
		const diagonal = {x: 1, y: -1};
		const straight = {x: 1, y: 0};
		core.buildSpots = {};

		for (let i = 0; i < 4; i++) {
			// Rotate for all 4 cardinal directions.
			this.rotateDirection(diagonal);
			this.rotateDirection(straight);

			// Check if we gain building space when placing a road.
			const pos = new RoomPosition(core.center.x, core.center.y, this.roomName);
			this.addDirection(pos, diagonal);
			this.addDirection(pos, diagonal);
			this.substractDirection(pos, straight);

			const roadPos = new RoomPosition(pos.x, pos.y, pos.roomName);
			this.substractDirection(pos, straight);
			if (this.terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
				this.addBuildSpot(core, pos);
			}
			this.substractDirection(pos, straight);
			if (this.terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
				this.addBuildSpot(core, pos);
			}

			// Road cannot be placed. Continue.
			// @todo Or determine if we should build a tunnel?
			if (this.terrain.get(roadPos.x, roadPos.y) === TERRAIN_MASK_WALL) continue;

			const buildSpots = [];
			this.addDirection(pos, diagonal);
			if (this.terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
				buildSpots.push(new RoomPosition(pos.x, pos.y, pos.roomName));
			}
			this.addDirection(pos, straight);
			if (this.terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
				buildSpots.push(new RoomPosition(pos.x, pos.y, pos.roomName));
			}
			this.addDirection(pos, straight);
			if (this.terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
				buildSpots.push(new RoomPosition(pos.x, pos.y, pos.roomName));
			}
			this.addDirection(pos, straight);
			this.substractDirection(pos, diagonal);
			if (this.terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
				buildSpots.push(new RoomPosition(pos.x, pos.y, pos.roomName));
			}
			if (buildSpots.length < 2) {
				this.addBuildSpot(core, roadPos);
				continue;
			}

			this.placeFlag(roadPos, 'road');
			const roadPos2 = new RoomPosition(pos.x, pos.y, pos.roomName);
			for (const pos of buildSpots) {
				if (pos.x === roadPos2.x && pos.y === roadPos2.y) continue;
				this.addBuildSpot(core, pos);
			}

			const buildSpots2 = [];

			this.addDirection(pos, diagonal);
			if (this.terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
				buildSpots2.push(new RoomPosition(pos.x, pos.y, pos.roomName));
			}
			this.addDirection(pos, straight);
			this.substractDirection(pos, diagonal);
			if (this.terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
				buildSpots2.push(new RoomPosition(pos.x, pos.y, pos.roomName));
			}
			this.addDirection(pos, straight);
			this.substractDirection(pos, diagonal);
			if (this.terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
				buildSpots2.push(new RoomPosition(pos.x, pos.y, pos.roomName));
			}
			if (buildSpots2.length < 2) {
				this.addBuildSpot(core, roadPos2);
				continue;
			}

			this.placeFlag(roadPos2, 'road');
			for (const pos of buildSpots2) {
				this.addBuildSpot(core, pos);
			}
		}

		// @todo Try other rotation direction and see if that's better.
	}

	rotateDirection(dir) {
		const temp = dir.x;
		dir.x = dir.y;
		dir.y = -temp;
	}

	addDirection(pos, dir) {
		pos.x += dir.x;
		pos.y += dir.y;
	}

	substractDirection(pos, dir) {
		pos.x -= dir.x;
		pos.y -= dir.y;
	}

	addBuildSpot(core, pos) {
		core.buildSpots[utilities.encodePosition(pos)] = {
			distance: Math.max(Math.abs(pos.x - core.center.x), Math.abs(pos.y - core.center.y)),
		};
	}

	removeBuildSpot(core, pos) {
		delete core.buildSpots[utilities.encodePosition(pos)];
	}

	placeRamparts(core) {
		for (let x = 0; x < CORE_SIZE; x++) {
			for (let y = 0; y < CORE_SIZE; y++) {
				if (core.ramparts[x][y] !== 1) continue;

				this.placeFlag(new RoomPosition(x + core.center.x - CORE_RADIUS, y + core.center.y - CORE_RADIUS, this.roomName), 'rampart');
			}
		}
	}
};
