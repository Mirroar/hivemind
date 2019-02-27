'use strict';

/* global hivemind PathFinder Room RoomPosition RoomVisual Structure
STRUCTURE_ROAD STRUCTURE_SPAWN CONTROLLER_STRUCTURES CONSTRUCTION_COST
STRUCTURE_CONTAINER STRUCTURE_TOWER STRUCTURE_STORAGE STRUCTURE_EXTENSION
STRUCTURE_TERMINAL STRUCTURE_LINK STRUCTURE_EXTRACTOR LOOK_STRUCTURES
STRUCTURE_RAMPART LOOK_CONSTRUCTION_SITES MAX_CONSTRUCTION_SITES OK
STRUCTURE_WALL CREEP_LIFE_TIME STRUCTURE_LAB STRUCTURE_NUKER FIND_STRUCTURES
STRUCTURE_POWER_SPAWN STRUCTURE_OBSERVER FIND_HOSTILE_STRUCTURES
FIND_MY_CONSTRUCTION_SITES TERRAIN_MASK_WALL FIND_SOURCES FIND_MINERALS */

const utilities = require('./utilities');

const MAX_ROOM_LEVEL = 8;

/**
 * Creates a room layout and makes sure the room is built accordingly.
 * @constructor
 *
 * @todo Split off RoomManager class.
 *
 * @param {string} roomName
 *   Name of the room this room planner is assigned to.
 */
const RoomPlanner = function (roomName) {
	this.roomPlannerVersion = 21;
	this.roomName = roomName;
	this.room = Game.rooms[roomName]; // Will not always be available.

	if (!Memory.rooms[roomName]) {
		Memory.rooms[roomName] = {};
	}

	if (!Memory.rooms[roomName].roomPlanner) {
		Memory.rooms[roomName].roomPlanner = {};
	}

	this.memory = Memory.rooms[roomName].roomPlanner;

	this.drawDebug();
};

/**
 * Draws a simple representation of the room layout using RoomVisuals.
 */
RoomPlanner.prototype.drawDebug = function () {
	const debugSymbols = {
		container: '⊔',
		extension: '⚬',
		lab: '🔬',
		link: '🔗',
		nuker: '☢',
		observer: '👁',
		powerSpawn: '⚡',
		rampart: '#',
		spawn: '⭕',
		storage: '⬓',
		terminal: '⛋',
		tower: '⚔',
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
	}
};

/**
 * Allows this room planner to give commands in controlled rooms.
 */
RoomPlanner.prototype.runLogic = function () {
	if (Game.cpu.bucket < 3500) return;

	this.checkAdjacentRooms();

	// Recalculate room layout if using a new version.
	if (!this.memory.plannerVersion || this.memory.plannerVersion !== this.roomPlannerVersion) {
		delete this.memory.locations;
		delete this.memory.planningTries;
		this.memory.plannerVersion = this.roomPlannerVersion;
	}

	// Sometimes room planning can't be finished successfully. Try a maximum of 10
	// times in that case.
	if (!this.memory.planningTries) this.memory.planningTries = 1;
	if (!this.memory.locations || (!this.memory.locations.observer && this.memory.planningTries <= 10)) {
		if (Game.cpu.getUsed() < Game.cpu.tickLimit / 2) {
			this.placeFlags();
			this.memory.planningTries++;
		}

		return;
	}

	if (Game.time % 100 !== 3 && !this.memory.runNextTick) return;
	delete this.memory.runNextTick;

	// Prune old planning cost matrixes. They will be regenerated if needed.
	delete this.memory.wallDistanceMatrix;
	delete this.memory.exitDistanceMatrix;

	this.roomConstructionSites = this.room.find(FIND_MY_CONSTRUCTION_SITES);
	this.constructionSitesByType = _.groupBy(this.roomConstructionSites, 'structureType');
	this.roomStructures = this.room.find(FIND_STRUCTURES);
	this.structuresByType = _.groupBy(this.roomStructures, 'structureType');
	this.newStructures = 0;

	this.cleanRoom();
	this.manageStructures();
};

/**
 * Removes structures that might prevent the room's construction.
 */
RoomPlanner.prototype.cleanRoom = function () {
	// Remove all roads not part of current room plan.
	const roomRoads = this.structuresByType[STRUCTURE_ROAD] || [];
	for (let i = 0; i < roomRoads.length; i++) {
		const road = roomRoads[i];
		if (!this.memory.locations.road || !this.memory.locations.road[utilities.encodePosition(road.pos)]) {
			road.destroy();
		}
	}

	// Remove unwanted walls.
	const roomWalls = this.structuresByType[STRUCTURE_WALL] || [];
	for (let i = 0; i < roomWalls.length; i++) {
		const wall = roomWalls[i];
		if (this.memory.locations.road[utilities.encodePosition(wall.pos)] ||
			this.memory.locations.spawn[utilities.encodePosition(wall.pos)] ||
			this.memory.locations.storage[utilities.encodePosition(wall.pos)] ||
			this.memory.locations.extension[utilities.encodePosition(wall.pos)]) {
			wall.destroy();
		}
	}

	// Remove hostile structures.
	const hostileStructures = this.room.find(FIND_HOSTILE_STRUCTURES);
	for (let i = 0; i < hostileStructures.length; i++) {
		hostileStructures[i].destroy();
	}
};

/**
 * Makes sure structures are built and removed as intended.
 */
RoomPlanner.prototype.manageStructures = function () {
	// Build road to sources asap to make getting energy easier.
	this.buildPlannedStructures('road.source', STRUCTURE_ROAD);

	// Make sure all current spawns have been built.
	const roomSpawns = this.structuresByType[STRUCTURE_SPAWN] || [];
	const roomSpawnSites = this.constructionSitesByType[STRUCTURE_SPAWN] || [];

	// Make sure spawns are built in the right place, remove otherwise.
	delete this.memory.hasMisplacedSpawn;
	if (roomSpawns.length >= CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][this.room.controller.level] && this.roomConstructionSites.length === 0) {
		this.removeMisplacedSpawn(roomSpawns);
	}
	else if (roomSpawns.length + roomSpawnSites.length < CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][this.room.controller.level]) {
		this.buildPlannedStructures('spawn', STRUCTURE_SPAWN);
	}

	// Build road to controller for easier upgrading.
	this.buildPlannedStructures('road.controller', STRUCTURE_ROAD);

	if (this.room.controller.level === 0) {
		// If we're waiting for a claim, busy ourselves by building roads.
		this.buildPlannedStructures('road', STRUCTURE_ROAD);
	}

	if (this.room.controller.level < 2) return;

	// At level 2, we can start building containers at sources and controller.
	this.removeUnplannedStructures('container', STRUCTURE_CONTAINER);
	this.buildPlannedStructures('container.source', STRUCTURE_CONTAINER);
	this.buildPlannedStructures('container.controller', STRUCTURE_CONTAINER);

	// Make sure towers are built in the right place, remove otherwise.
	this.removeUnplannedStructures('tower', STRUCTURE_TOWER, 1);
	this.buildPlannedStructures('tower', STRUCTURE_TOWER);

	// Build storage ASAP.
	this.buildPlannedStructures('storage', STRUCTURE_STORAGE);

	// Make sure extensions are built in the right place, remove otherwise.
	this.removeUnplannedStructures('extension', STRUCTURE_EXTENSION, 1);
	this.buildPlannedStructures('extension', STRUCTURE_EXTENSION);

	// Also build terminal when available.
	this.buildPlannedStructures('terminal', STRUCTURE_TERMINAL);

	// Make sure links are built in the right place, remove otherwise.
	this.removeUnplannedStructures('link', STRUCTURE_LINK, 1);
	this.buildPlannedStructures('link', STRUCTURE_LINK);

	// Build extractor and related container if available.
	if (CONTROLLER_STRUCTURES[STRUCTURE_EXTRACTOR][this.room.controller.level] > 0) {
		this.buildPlannedStructures('extractor', STRUCTURE_EXTRACTOR);
		this.buildPlannedStructures('container.mineral', STRUCTURE_CONTAINER);
	}

	if (this.room.controller.level < 3) return;

	// At level 3, we can build all remaining roads.
	this.buildPlannedStructures('road', STRUCTURE_ROAD);

	if (this.room.controller.level < 4) return;

	// Make sure all requested ramparts are built.
	this.buildPlannedStructures('rampart', STRUCTURE_RAMPART);

	// Slate all unmanaged walls and ramparts for deconstruction.
	const unwantedDefenses = this.room.find(FIND_STRUCTURES, {
		filter: structure => {
			if (structure.structureType === STRUCTURE_WALL) return true;
			if (structure.structureType === STRUCTURE_RAMPART) {
				// Keep rampart if it is one we have placed.
				const pos = utilities.encodePosition(structure.pos);
				if (this.memory.locations.rampart && this.memory.locations.rampart[pos]) return false;

				return true;
			}

			return false;
		},
	});

	if (!this.memory.dismantle) {
		this.memory.dismantle = {};
	}

	for (const structure of unwantedDefenses) {
		this.memory.dismantle[structure.id] = 1;
	}

	// Further constructions should only happen in safe rooms.
	if (this.room && this.room.isEvacuating()) return;
	if (!this.checkWallIntegrity()) return;
	hivemind.log('room plan', this.roomName).debug('walls are finished');

	// Make sure labs are built in the right place, remove otherwise.
	this.removeUnplannedStructures('lab', STRUCTURE_LAB, 1);
	this.buildPlannedStructures('lab', STRUCTURE_LAB);

	// Make sure all current nukers have been built.
	if (_.size(this.roomConstructionSites) === 0) this.removeUnplannedStructures('nuker', STRUCTURE_NUKER, 1);
	this.buildPlannedStructures('nuker', STRUCTURE_NUKER);

	// Make sure all current power spawns have been built.
	if (_.size(this.roomConstructionSites) === 0) this.removeUnplannedStructures('powerSpawn', STRUCTURE_POWER_SPAWN, 1);
	this.buildPlannedStructures('powerSpawn', STRUCTURE_POWER_SPAWN);

	// Make sure all current observers have been built.
	if (_.size(this.roomConstructionSites) === 0) this.removeUnplannedStructures('observer', STRUCTURE_OBSERVER, 1);
	this.buildPlannedStructures('observer', STRUCTURE_OBSERVER);
};

/**
 * Try placing construction sites of the given type at all locations.
 *
 * @param {string} locationType
 *   The type of location that should be checked.
 * @param {string} structureType
 *   The type of structure to place.
 *
 * @return {boolean}
 *   True if we can continue building.
 */
RoomPlanner.prototype.buildPlannedStructures = function (locationType, structureType) {
	let canBuildMore = true;
	for (const posName of _.keys(this.memory.locations[locationType])) {
		const pos = utilities.decodePosition(posName);

		canBuildMore &= this.tryBuild(pos, structureType);
	}

	return canBuildMore;
};

/**
 * Tries to place a construction site.
 *
 * @param {RoomPosition} pos
 *   The position at which to place the structure.
 * @param {string} structureType
 *   The type of structure to place.
 *
 * @return {boolean}
 *   True if we can continue building.
 */
RoomPlanner.prototype.tryBuild = function (pos, structureType) {
	// Check if there's a structure here already.
	const structures = pos.lookFor(LOOK_STRUCTURES);
	for (const i in structures) {
		if (structures[i].structureType === structureType) {
			// Structure is here, continue.
			return true;
		}
	}

	// Check if there's a construction site here already.
	const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
	for (const i in sites) {
		if (sites[i].structureType === structureType) {
			// Structure is being built, wait until finished.
			return false;
		}
	}

	if (this.newStructures + this.roomConstructionSites.length < 5 && _.size(Game.constructionSites) < MAX_CONSTRUCTION_SITES * 0.9) {
		if (pos.createConstructionSite(structureType) === OK) {
			this.newStructures++;
			// Structure is being built, wait until finished.
			return false;
		}

		// Some other structure is blocking or we can't build more of this structure.
		// Building logic should continue for now.
		return true;
	}

	// We can't build anymore in this room right now.
	return false;
};

/**
 * Removes misplaced spawns for rebuilding at a new location.
 *
 * @param {StructureSpawn[]} roomSpawns
 *   List of spawns in the room.
 *
 * @return {boolean}
 *   True if a spawn was destroyed this tick.
 */
RoomPlanner.prototype.removeMisplacedSpawn = function (roomSpawns) {
	for (let i = 0; i < roomSpawns.length; i++) {
		const spawn = roomSpawns[i];
		if (this.memory.locations.spawn && this.memory.locations.spawn[utilities.encodePosition(spawn.pos)]) continue;
		if (spawn.spawning) continue;

		// Only destroy spawn if there are enough resources and builders available.
		const resourcesAvailable = (this.room.storage && this.room.storage.store.energy > CONSTRUCTION_COST[STRUCTURE_SPAWN] * 2 && _.size(this.room.creepsByRole.builder) > 1);
		if (!resourcesAvailable && _.size(roomSpawns) === 1) return false;

		// This spawn is misplaced, set a flag for spawning more builders to help.
		if (this.room.storage && this.room.storage.store.energy > CONSTRUCTION_COST[STRUCTURE_SPAWN] * 3) {
			this.memory.hasMisplacedSpawn = true;
		}

		let buildPower = 0;
		for (const creep of _.values(this.room.creepsByRole.builder)) {
			if (creep.ticksToLive) {
				buildPower += creep.memory.body.work * creep.ticksToLive / CREEP_LIFE_TIME;
			}
		}

		if (buildPower > 10) {
			spawn.destroy();
			this.memory.runNextTick = true;
			// Only kill of one spawn at a time, it should be rebuilt right away next tick!
			return true;
		}
	}

	return false;
};

/**
 * Remove structures that are not part of the current building plan.
 */
RoomPlanner.prototype.removeUnplannedStructures = function (locationType, structureType, amount) {
	const structures = this.structuresByType[structureType] || [];
	const sites = this.constructionSitesByType[structureType] || [];

	let limit = CONTROLLER_STRUCTURES[structureType][this.room.controller.level];
	if (amount) {
		limit = amount + structures.length + sites.length - limit;
	}

	let count = 0;
	if (this.memory.locations[locationType]) {
		for (const structure of structures) {
			if (!this.memory.locations[locationType][utilities.encodePosition(structure.pos)]) {
				if (count < limit) {
					structure.destroy();
					count++;
				}
				else break;
			}
		}
	}
};

/**
 * Checks if all ramparts in the room have at least 500.000 hits.
 *
 * @return {boolean}
 *   True if walls are considered complete.
 */
RoomPlanner.prototype.checkWallIntegrity = function () {
	for (const posName of _.keys(this.memory.locations.rampart)) {
		const pos = utilities.decodePosition(posName);

		// Check if there's a rampart here already.
		const structures = pos.lookFor(LOOK_STRUCTURES);
		if (_.filter(structures, structure => structure.structureType === STRUCTURE_RAMPART && structure.hits >= 500000).length === 0) {
			return false;
		}
	}

	return true;
};

/**
 * Decides whether a dismantler is needed in the current room.
 */
RoomPlanner.prototype.needsDismantling = function () {
	return _.size(this.memory.dismantle) > 0;
};

/**
 * Decides on a structure that needs to be dismantled.
 */
RoomPlanner.prototype.getDismantleTarget = function () {
	if (!this.needsDismantling()) return null;

	for (const id in this.memory.dismantle) {
		const structure = Game.getObjectById(id);
		if (structure) {
			// If there's a rampart on it, dismantle the rampart first if requested, or just destroy the building immediately.
			const structures = structure.pos.lookFor(LOOK_STRUCTURES);
			let innocentRampartFound = false;
			for (const i in structures) {
				if (structures[i].structureType === STRUCTURE_RAMPART) {
					if (this.memory.dismantle[structures[i].id]) {
						return structures[i];
					}

					structure.destroy();
					innocentRampartFound = true;
					break;
				}
			}

			if (!innocentRampartFound) {
				return structure;
			}
		}
		else {
			delete this.memory.dismantle[id];
		}
	}

	return null;
};

/**
 * Decides whether a structure is supposed to be dismantled.
 */
Structure.prototype.needsDismantling = function () {
	if (!this.room.roomPlanner || !this.room.roomPlanner.needsDismantling()) return false;

	if (this.room.roomPlanner.memory.dismantle && this.room.roomPlanner.memory.dismantle[this.id]) {
		return true;
	}

	return false;
};

/**
 * Places a room planner flag of a certain type.
 */
RoomPlanner.prototype.placeFlag = function (pos, flagType, pathFindingCost) {
	const posName = utilities.encodePosition(pos);

	if (!this.memory.locations) {
		this.memory.locations = {};
	}

	if (!this.memory.locations[flagType]) {
		this.memory.locations[flagType] = {};
	}

	this.memory.locations[flagType][posName] = 1;

	if (typeof pathFindingCost === 'undefined') {
		pathFindingCost = 255;
	}

	if (pathFindingCost) {
		this.buildingMatrix.set(pos.x, pos.y, pathFindingCost);
	}
};

/**
 * Generates CostMatrixes needed for structure placement.
 */
RoomPlanner.prototype.generateDistanceMatrixes = function () {
	const matrix = new PathFinder.CostMatrix();
	const exitMatrix = new PathFinder.CostMatrix();
	const terrain = new Room.Terrain(this.roomName);

	for (let x = 0; x < 50; x++) {
		for (let y = 0; y < 50; y++) {
			if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
				matrix.set(x, y, 255);
				exitMatrix.set(x, y, 255);
				continue;
			}

			if (x === 0 || x === 49 || y === 0 || y === 49) {
				exitMatrix.set(x, y, 1);
			}

			let found = false;
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					const ax = (x + dx < 0 ? 0 : (x + dx > 49 ? 49 : x + dx));
					const ay = (y + dy < 0 ? 0 : (y + dy > 49 ? 49 : y + dy));

					if ((ax !== 0 || ay !== 0) && terrain.get(ax, ay) === TERRAIN_MASK_WALL) {
						matrix.set(x, y, 1);
						found = true;
						break;
					}
				}

				if (found) break;
			}
		}
	}

	let currentDistance = 1;
	let done = false;
	while (!done) {
		done = true;

		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				if (matrix.get(x, y) === 0) {
					let found = false;
					for (let dx = -1; dx <= 1; dx++) {
						for (let dy = -1; dy <= 1; dy++) {
							const ax = (x + dx < 0 ? 0 : (x + dx > 49 ? 49 : x + dx));
							const ay = (y + dy < 0 ? 0 : (y + dy > 49 ? 49 : y + dy));

							if ((ax !== 0 || ay !== 0) && matrix.get(ax, ay) === currentDistance) {
								matrix.set(x, y, currentDistance + 1);
								done = false;
								found = true;
								break;
							}
						}

						if (found) break;
					}
				}

				if (exitMatrix.get(x, y) === 0) {
					let found = false;
					for (let dx = -1; dx <= 1; dx++) {
						for (let dy = -1; dy <= 1; dy++) {
							const ax = (x + dx < 0 ? 0 : (x + dx > 49 ? 49 : x + dx));
							const ay = (y + dy < 0 ? 0 : (y + dy > 49 ? 49 : y + dy));

							if ((ax !== 0 || ay !== 0) && exitMatrix.get(ax, ay) === currentDistance) {
								exitMatrix.set(x, y, currentDistance + 1);
								done = false;
								found = true;
								break;
							}
						}

						if (found) break;
					}
				}
			}
		}

		currentDistance++;
	}

	this.memory.wallDistanceMatrix = matrix.serialize();
	this.memory.exitDistanceMatrix = exitMatrix.serialize();
};

/**
 * Find positions from where many exit tiles are in short range.
 */
RoomPlanner.prototype.findTowerPositions = function () {
	const positions = {
		N: {count: 0, tiles: []},
		E: {count: 0, tiles: []},
		S: {count: 0, tiles: []},
		W: {count: 0, tiles: []},
	};

	const allDirectionsSafe = _.sum(this.memory.adjacentSafe) === 4;
	const terrain = new Room.Terrain(this.roomName);
	for (let x = 1; x < 49; x++) {
		for (let y = 1; y < 49; y++) {
			if (this.buildingMatrix.get(x, y) !== 0 && this.buildingMatrix.get(x, y) !== 10) continue;
			if (this.safetyMatrix.get(x, y) !== 1) continue;
			if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
			let score = 0;

			let tileDir;
			if (x > y) {
				// Northeast.
				if (49 - x > y) tileDir = 'N';
				else tileDir = 'E';
			}
			else {
				// Southwest.
				if (49 - x > y) tileDir = 'W';
				else tileDir = 'S';
			}

			// No need to check in directions where there is no exit.
			if (_.size(this.exitTiles[tileDir]) === 0) continue;

			// Don't count exits toward "safe" rooms or dead ends.
			if (!allDirectionsSafe && this.memory.adjacentSafe && this.memory.adjacentSafe[tileDir]) continue;

			for (const dir in this.exitTiles) {
				// Don't score distance to exits toward "safe" rooms or dead ends.
				// Unless all directions are safe.
				if (!allDirectionsSafe && this.memory.adjacentSafe && this.memory.adjacentSafe[dir]) continue;

				for (const i in this.exitTiles[dir]) {
					score += 1 / this.exitTiles[dir][i].getRangeTo(x, y);
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

	if (!this.memory.wallDistanceMatrix) {
		this.generateDistanceMatrixes();
		return;
	}

	// Reset location memory, to be replaced with new flags.
	this.memory.locations = {};

	const wallDistanceMatrix = PathFinder.CostMatrix.deserialize(this.memory.wallDistanceMatrix);
	const exitDistanceMatrix = PathFinder.CostMatrix.deserialize(this.memory.exitDistanceMatrix);
	this.wallDistanceMatrix = wallDistanceMatrix;
	this.exitDistanceMatrix = exitDistanceMatrix;

	// Prepare CostMatrix and exit points.
	const matrix = new PathFinder.CostMatrix();
	this.buildingMatrix = matrix;
	const exits = {
		N: [],
		S: [],
		W: [],
		E: [],
	};
	this.exitTiles = exits;
	const walls = [];
	const roads = [];
	this.roads = roads;
	const centerPositions = [];
	const terrain = new Room.Terrain(this.roomName);
	for (let x = 0; x < 50; x++) {
		for (let y = 0; y < 50; y++) {
			// Treat exits as unwalkable for in-room pathfinding.
			if (x === 0 || y === 0 || x === 49 || y === 49) {
				if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
					if (x === 0) {
						exits.W.push(new RoomPosition(x, y, this.roomName));
					}

					if (x === 49) {
						exits.E.push(new RoomPosition(x, y, this.roomName));
					}

					if (y === 0) {
						exits.N.push(new RoomPosition(x, y, this.roomName));
					}

					if (y === 49) {
						exits.S.push(new RoomPosition(x, y, this.roomName));
					}
				}

				matrix.set(x, y, 255);
				continue;
			}

			// Avoid pathfinding close to walls to keep space for dodging and building / wider roads.
			const wallDistance = wallDistanceMatrix.get(x, y);
			const exitDistance = exitDistanceMatrix.get(x, y);

			if (wallDistance === 1) {
				matrix.set(x, y, 10);
			}

			if (wallDistance >= 4 && wallDistance < 255 && exitDistance > 8) {
				centerPositions.push(new RoomPosition(x, y, this.roomName));
			}

			if (exitDistance <= 2) {
				// Avoid tiles we can't build ramparts on.
				matrix.set(x, y, 20);
			}

			if (exitDistance > 2 && exitDistance <= 5) {
				// Avoid area near exits and room walls to not get shot at.
				matrix.set(x, y, 10);
			}

			if (exitDistance === 3) {
				matrix.set(x, y, 10);
				walls.push(new RoomPosition(x, y, this.roomName));
			}
		}
	}

	// Decide where exit regions are and where walls should be placed.
	const exitCenters = {};
	for (const dir in exits) {
		exitCenters[dir] = [];

		let startPos = null;
		let prevPos = null;
		for (const i in exits[dir]) {
			const pos = exits[dir][i];

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

		for (const i in exitCenters[dir]) {
			this.placeFlag(exitCenters[dir][i], 'exit', null);
		}
	}

	// Decide where room center should be by averaging exit positions.
	let cx = 0;
	let cy = 0;
	let count = 0;
	for (const dir in exitCenters) {
		for (const i in exitCenters[dir]) {
			count++;
			cx += exitCenters[dir][i].x;
			cy += exitCenters[dir][i].y;
		}
	}

	cx = Math.floor(cx / count);
	cy = Math.floor(cy / count);

	// Find closest position with distance from walls around there.
	const roomCenter = (new RoomPosition(cx, cy, this.roomName)).findClosestByRange(centerPositions);
	this.roomCenter = roomCenter;
	this.placeFlag(roomCenter, 'center', null);

	// Do another flood fill pass from interesting positions to remove walls that don't protect anything.
	this.pruneWalls(walls, wallDistanceMatrix);

	// Actually place ramparts.
	for (const i in walls) {
		if (walls[i].isRelevant) {
			this.placeFlag(walls[i], 'rampart', null);
		}
	}

	// Center is accessible via the 4 cardinal directions.
	const centerEntrances = [
		new RoomPosition(roomCenter.x + 2, roomCenter.y, this.roomName),
		new RoomPosition(roomCenter.x - 2, roomCenter.y, this.roomName),
		new RoomPosition(roomCenter.x, roomCenter.y + 2, this.roomName),
		new RoomPosition(roomCenter.x, roomCenter.y - 2, this.roomName),
	];
	this.roomCenterEntrances = centerEntrances;

	// Find paths from each exit towards the room center for making roads.
	for (const dir in exitCenters) {
		for (const i in exitCenters[dir]) {
			this.scanAndAddRoad(exitCenters[dir][i], centerEntrances, matrix, roads);
		}
	}

	const planner = this;
	const tileFreeForBuilding = function (x, y, allowRoads) {
		return planner.isBuildableTile(x, y, allowRoads);
	};

	const placeLink = function (sourceRoads) {
		let linkPlaced = false;
		for (const i in sourceRoads) {
			for (let dx = -1; dx <= 1; dx++) {
				for (let dy = -1; dy <= 1; dy++) {
					if (dx === 0 && dy === 0) continue;

					if (tileFreeForBuilding(sourceRoads[i].x + dx, sourceRoads[i].y + dy)) {
						planner.placeFlag(new RoomPosition(sourceRoads[i].x + dx, sourceRoads[i].y + dy, sourceRoads[i].roomName), 'link');
						linkPlaced = true;
						break;
					}
				}

				if (linkPlaced) break;
			}

			if (linkPlaced) break;
		}
	};

	const placeContainer = function (sourceRoads, containerType) {
		let targetPos = null;
		if (tileFreeForBuilding(sourceRoads[1].x, sourceRoads[1].y, true)) {
			targetPos = sourceRoads[1];
		}
		else if (tileFreeForBuilding(sourceRoads[0].x, sourceRoads[0].y, true)) {
			targetPos = sourceRoads[0];
		}
		else {
			for (const i in sourceRoads) {
				for (let dx = -1; dx <= 1; dx++) {
					for (let dy = -1; dy <= 1; dy++) {
						if (i > 3) continue;

						if (tileFreeForBuilding(sourceRoads[i].x + dx, sourceRoads[i].y + dy, true)) {
							targetPos = new RoomPosition(sourceRoads[i].x + dx, sourceRoads[i].y + dy, sourceRoads[i].roomName);
							break;
						}
					}

					if (targetPos) break;
				}

				if (targetPos) break;
			}
		}

		if (targetPos) {
			if (containerType) {
				planner.placeFlag(targetPos, 'container.' + containerType, null);
			}

			planner.placeFlag(targetPos, 'container', 1);
		}
	};

	if (this.room) {
		// @todo Have intelManager save locations (not just IDs) of sources, minerals and controller, so we don't need room access here.
		// We also save which road belongs to which path, so we can selectively autobuild roads during room bootstrap instead of building all roads at once.
		if (this.room.controller) {
			const controllerRoads = this.scanAndAddRoad(this.room.controller.pos, centerEntrances, matrix, roads);
			for (const i in controllerRoads) {
				if (i === 0) continue;
				this.placeFlag(controllerRoads[i], 'road.controller', null);
			}

			placeContainer(controllerRoads, 'controller');

			// Place a link near controller, but off the calculated path.
			placeLink(controllerRoads);
		}

		if (this.room.mineral) {
			this.placeFlag(this.room.mineral.pos, 'extractor');
			const mineralRoads = this.scanAndAddRoad(this.room.mineral.pos, centerEntrances, matrix, roads);
			for (const i in mineralRoads) {
				this.placeFlag(mineralRoads[i], 'road.mineral', null);
			}

			placeContainer(mineralRoads, 'mineral');

			// Make sure no other paths get led through harvester position.
			matrix.set(mineralRoads[0].x, mineralRoads[0].y, 255);
		}

		if (this.room.sources) {
			for (const i in this.room.sources) {
				const sourceRoads = this.scanAndAddRoad(this.room.sources[i].pos, centerEntrances, matrix, roads);
				for (const i in sourceRoads) {
					this.placeFlag(sourceRoads[i], 'road.source', null);
				}

				placeContainer(sourceRoads, 'source');

				// Place a link near sources, but off the calculated path.
				placeLink(sourceRoads);

				// Make sure no other paths get led through harvester position.
				matrix.set(sourceRoads[0].x, sourceRoads[0].y, 255);
			}
		}
	}

	for (const i in roads) {
		this.placeFlag(roads[i], 'road', 1);
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

	const end = Game.cpu.getUsed();
	console.log('Planning for', this.roomName, 'took', end - start, 'CPU');
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
};

/**
 * Places parking spot for helper creep.
 */
RoomPlanner.prototype.placeHelperParkingLot = function () {
	const nextPos = this.getNextAvailableBuildSpot();
	if (!nextPos) return;

	const flagKey = 'Helper:' + nextPos.roomName;
	if (Game.flags[flagKey]) {
		Game.flags[flagKey].setPosition(nextPos);
	}
	else {
		nextPos.createFlag(flagKey);
	}

	this.placeFlag(nextPos, 'road', 255);

	this.placeAccessRoad(nextPos);

	this.filterOpenList(utilities.encodePosition(nextPos));
};

/**
 * Places extension bays.
 */
RoomPlanner.prototype.placeBays = function () {
	let bayCount = 0;
	while (this.canPlaceMore('extension')) {
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

		if (maxExtensions < 4) break;

		this.placeAccessRoad(bestPos);

		// Make sure there is a road in the center of the bay.
		this.placeFlag(bestPos, 'road', 1);

		// Fill other unused spots with extensions.
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				if (!this.isBuildableTile(bestPos.x + dx, bestPos.y + dy)) continue;

				this.placeFlag(new RoomPosition(bestPos.x + dx, bestPos.y + dy, bestPos.roomName), 'extension');
			}
		}

		// Place a flag to mark this bay.
		const flagKey = 'Bay:' + bestPos.roomName + ':' + bayCount;
		if (Game.flags[flagKey]) {
			Game.flags[flagKey].setPosition(bestPos);
		}
		else {
			bestPos.createFlag(flagKey);
		}

		bayCount++;

		// Reinitialize pathfinding.
		this.startBuildingPlacement();
	}

	// Remove other bay flags in room that might be left over.
	for (let i = bayCount; i < 30; i++) {
		const flagKey = 'Bay:' + this.roomName + ':' + i;
		if (Game.flags[flagKey]) {
			Game.flags[flagKey].remove();
		}
	}
};

/**
 * Place labs in big compounds.
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
		for (const dir in positions) {
			for (const i in positions[dir].tiles) {
				const tile = positions[dir].tiles[i];
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
			roomCallback: roomName => matrix,
			maxRooms: 1,
			plainCost: 1,
			swampCost: 1, // We don't care about cost, just about possibility.
		});
		if (result.incomplete) continue;

		positions[bestDir].count++;
		this.placeFlag(new RoomPosition(info.pos.x, info.pos.y, info.pos.roomName), 'tower');
	}

	// Also create roads to all towers.
	for (const posName in this.memory.locations.tower || []) {
		const pos = utilities.decodePosition(posName);

		this.placeAccessRoad(pos);
	}
};

/**
 * Places all remaining structures of a given type.
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
 */
RoomPlanner.prototype.placeAccessRoad = function (position) {
	// Plan road out of labs.
	const accessRoads = this.scanAndAddRoad(position, this.roomCenterEntrances, this.buildingMatrix, this.roads);
	for (const i in accessRoads) {
		this.placeFlag(accessRoads[i], 'road', 1);
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
 */
RoomPlanner.prototype.getNextAvailableBuildSpot = function () {
	while (_.size(this.openList) > 0) {
		let minDist = null;
		let nextPos = null;
		let nextInfo = null;
		for (const posName in this.openList) {
			const info = this.openList[posName];
			const pos = utilities.decodePosition(posName);
			if (!minDist || info.range < minDist) {
				minDist = info.range;
				nextPos = pos;
				nextInfo = info;
			}
		}

		if (!nextPos) break;

		delete this.openList[utilities.encodePosition(nextPos)];
		this.closedList[utilities.encodePosition(nextPos)] = true;

		// Add unhandled adjacent tiles to open list.
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				if (dx === 0 && dy === 0) continue;
				const pos = new RoomPosition(nextPos.x + dx, nextPos.y + dy, this.roomName);

				if (!this.isBuildableTile(pos.x, pos.y, true)) continue;

				const posName = utilities.encodePosition(pos);
				if (this.openList[posName] || this.closedList[posName]) continue;

				const newPath = {};
				for (const oldPos in nextInfo.path) {
					newPath[oldPos] = true;
				}

				newPath[posName] = true;
				this.openList[posName] = {
					range: minDist + 1,
					path: newPath,
				};
			}
		}

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

RoomPlanner.prototype.getCurrentBuildSpotInfo = function () {
	return this.currentBuildSpot.info;
};

/**
 * Checks if a structure can be placed on the given tile.
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
	if (matrixValue === 10 && this.wallDistanceMatrix.get(x, y) === 1) return true;

	// @todo Find out why this check was initially introduced.
	if (matrixValue > 1) return false;

	// Don't build on roads if not allowed.
	if (matrixValue === 1 && !allowRoads) return false;

	return true;
};

/**
 * Determines whether more of a certain structure could be placed.
 */
RoomPlanner.prototype.canPlaceMore = function (structureType) {
	return _.size(this.memory.locations[structureType] || []) < CONTROLLER_STRUCTURES[structureType][MAX_ROOM_LEVEL];
};

/**
 * Removes all pathfinding options that use the given position.
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
 */
RoomPlanner.prototype.pruneWallFromTiles = function (walls, wallDistanceMatrix, tiles, onlyRelevant) {
	const openList = {};
	const closedList = {};
	let safetyValue = 1;

	for (const i in tiles) {
		openList[tiles[i]] = true;
	}

	// If we're doing an additionall pass, unmark walls first.
	if (onlyRelevant) {
		safetyValue = 2;
		for (const i in walls) {
			walls[i].wasRelevant = false;
			if (walls[i].isRelevant) {
				walls[i].wasRelevant = true;
				walls[i].isRelevant = false;
			}
		}
	}

	// Flood fill, marking all walls we touch as relevant.
	while (_.size(openList) > 0) {
		let nextPos = null;
		for (const posName in openList) {
			nextPos = utilities.decodePosition(posName);
			break;
		}

		// Record which tiles are safe or unsafe.
		this.safetyMatrix.set(nextPos.x, nextPos.y, safetyValue);

		delete openList[utilities.encodePosition(nextPos)];
		closedList[utilities.encodePosition(nextPos)] = true;

		// Add unhandled adjacent tiles to open list.
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				if (dx === 0 && dy === 0) continue;
				const pos = new RoomPosition(nextPos.x + dx, nextPos.y + dy, this.roomName);
				if (pos.x < 1 || pos.x > 48 || pos.y < 1 || pos.y > 48) continue;

				// Ignore walls.
				if (wallDistanceMatrix.get(pos.x, pos.y) > 100) continue;

				const posName = utilities.encodePosition(pos);
				if (openList[posName] || closedList[posName]) continue;

				// If there's a rampart to be built there, mark it and move on.
				let wallFound = false;
				for (const i in walls) {
					if (walls[i].x === pos.x && walls[i].y === pos.y) {
						// Skip walls that might have been discarded in a previous pass.
						if (onlyRelevant && !walls[i].wasRelevant) continue;

						walls[i].isRelevant = true;
						wallFound = true;
						closedList[posName] = true;
						break;
					}
				}

				if (!wallFound) {
					openList[posName] = true;
				}
			}
		}
	}
};

/**
 * Marks all walls which are adjacent to the "inner area" of the room.
 */
RoomPlanner.prototype.pruneWalls = function (walls, wallDistanceMatrix) {
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

	this.pruneWallFromTiles(walls, wallDistanceMatrix, openList);

	// Do a second pass, checking which walls get touched by unsafe exits.

	// Prepare CostMatrix and exit points.
	const exits = [];
	const terrain = new Room.Terrain(this.roomName);

	for (let i = 0; i < 50; i++) {
		if (terrain.get(0, i) !== TERRAIN_MASK_WALL && (!this.memory.adjacentSafe || !this.memory.adjacentSafe.W)) {
			exits.push(utilities.encodePosition(new RoomPosition(0, i, this.roomName)));
		}

		if (terrain.get(49, i) !== TERRAIN_MASK_WALL && (!this.memory.adjacentSafe || !this.memory.adjacentSafe.E)) {
			exits.push(utilities.encodePosition(new RoomPosition(49, i, this.roomName)));
		}

		if (terrain.get(i, 0) !== TERRAIN_MASK_WALL && (!this.memory.adjacentSafe || !this.memory.adjacentSafe.N)) {
			exits.push(utilities.encodePosition(new RoomPosition(i, 0, this.roomName)));
		}

		if (terrain.get(i, 49) !== TERRAIN_MASK_WALL && (!this.memory.adjacentSafe || !this.memory.adjacentSafe.S)) {
			exits.push(utilities.encodePosition(new RoomPosition(i, 49, this.roomName)));
		}
	}

	this.pruneWallFromTiles(walls, wallDistanceMatrix, exits, true);

	// Safety matrix has been filled, now mark any tiles unsafe that can be reached by a ranged attacker.
	for (let x = 0; x < 50; x++) {
		for (let y = 0; y < 50; y++) {
			// Only check around unsafe tiles.
			if (this.safetyMatrix.get(x, y) !== 2) continue;

			for (let dx = -3; dx <= 3; dx++) {
				for (let dy = -3; dy <= 3; dy++) {
					if (dx === 0 && dy === 0) continue;
					if (x + dx < 0 || x + dx > 49 || y + dy < 0 || y + dy > 49) continue;
					if (this.safetyMatrix.get(x + dx, y + dy) === 1) {
						// Safe tile in range of an unsafe tile, mark as neutral.
						this.safetyMatrix.set(x + dx, y + dy, 0);
					}
				}
			}
		}
	}
};

RoomPlanner.prototype.scanAndAddRoad = function (from, to, matrix, roads) {
	const result = PathFinder.search(from, to, {
		roomCallback: roomName => matrix,
		maxRooms: 1,
		plainCost: 2,
		swampCost: 2, // Swamps are more expensive to build roads on, but once a road is on them, creeps travel at the same speed.
		heuristicWeight: 0.9,
	});

	const newRoads = [];
	if (result.path) {
		for (const j in result.path) {
			const pos = result.path[j];
			roads.push(pos);
			newRoads.push(pos);

			// Since we're building a road on this tile anyway, prefer it for future pathfinding.
			matrix.set(pos.x, pos.y, 1);
		}
	}

	return newRoads;
};

/**
 * Checks which adjacent rooms are owned by ourselves or
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
				'Exit safety has changed for room ' + this.room.name + '!\n\n' +
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
	if (this.memory.locations && this.memory.locations.center) {
		for (const pos of _.keys(this.memory.locations.center)) {
			return utilities.decodePosition(pos);
		}
	}
};

module.exports = RoomPlanner;
