var utilities = require('utilities');

var MAX_ROOM_LEVEL = 8;

var RoomPlanner = function (roomName) {
  this.roomPlannerVersion = 19;
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
  let debugSymbols = {
    container: '⊔',
    extension: '⚬',
    lab: '🔬',
    link: '🔗',
    nuker: '☢',
    powerSpawn: '⚡',
    rampart: '#',
    spawn: '⭕',
    storage: '⬓',
    terminal: '⛋',
    tower: '⚔',
  };

  let visual = new RoomVisual(this.roomName);

  if (this.memory.locations) {
    for (let locationType in this.memory.locations) {
      if (!debugSymbols[locationType]) continue;

      let positions = this.memory.locations[locationType];
      for (let posName in positions) {
        let pos = utilities.decodePosition(posName);

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
  if (!this.memory.plannerVersion || this.memory.plannerVersion != this.roomPlannerVersion) {
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
  if (Game.time % 100 != 3 && !this.memory.runNextTick) return;
  delete this.memory.runNextTick;

  // Prune old planning cost matrixes. They will be regenerated if needed.
  delete this.memory.wallDistanceMatrix;
  delete this.memory.exitDistanceMatrix;

  var roomConstructionSites = this.room.find(FIND_MY_CONSTRUCTION_SITES);
  this.roomConstructionSites = roomConstructionSites;
  this.constructionSitesByType = _.groupBy(roomConstructionSites, 'structureType');
  var roomStructures = this.room.find(FIND_STRUCTURES);
  this.roomStructures = roomStructures;
  this.structuresByType = _.groupBy(roomStructures, 'structureType');
  this.newStructures = 0;
  let doneBuilding = true;

  this.cleanRoom();

  // Build road to sources asap to make getting energy easier.
  if (this.buildPlannedStructures('road.source', STRUCTURE_ROAD)) return;

  // Make sure all current spawns have been built.
  var roomSpawns = this.structuresByType[STRUCTURE_SPAWN] || [];
  var roomSpawnSites =  this.constructionSitesByType[STRUCTURE_SPAWN] || [];

  // Make sure spawns are built in the right place, remove otherwise.
  delete this.memory.hasMisplacedSpawn;
  if (roomSpawns.length == CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][this.room.controller.level] && roomConstructionSites.length == 0) {
    for (let i = 0; i < roomSpawns.length; i++) {
      let spawn = roomSpawns[i];
      if (!this.memory.locations.spawn || !this.memory.locations.spawn[utilities.encodePosition(spawn.pos)]) {
        // Only destroy spawn if there are enough resources and builders available.
        let resourcesAvailable = (this.room.storage && this.room.storage.store.energy > CONSTRUCTION_COST[STRUCTURE_SPAWN] * 2 && _.size(this.room.creepsByRole.builder) > 1);
        if ((resourcesAvailable || _.size(roomSpawns) > 1)) {
          // This spawn is misplaced, set a flag for spawning more builders to help.
          if (this.room.storage && this.room.storage.store.energy > CONSTRUCTION_COST[STRUCTURE_SPAWN] * 3) {
            this.memory.hasMisplacedSpawn = true;
          }

          if (!spawn.spawning) {
            let buildPower = 0;
            for (let j in this.room.creepsByRole.builder) {
              let creep = this.room.creepsByRole.builder[j];

              if (creep.ticksToLive) {
                buildPower += creep.memory.body.work * creep.ticksToLive / CREEP_LIFE_TIME;
              }
            }

            if (buildPower > 10) {
              spawn.destroy();
              this.memory.runNextTick = true;
              // Only kill of one spawn at a time, it should be rebuilt right away next tick!
              return;
            }
          }
        }

        // No need to check for another misplaced spawn, it won't be moved either.
        break;
      }
    }
  }
  else if (roomSpawns.length + roomSpawnSites.length < CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][this.room.controller.level]) {
    if (this.buildPlannedStructures('spawn', STRUCTURE_SPAWN)) return;
  }

  // Build road to controller for easier upgrading.
  if (this.buildPlannedStructures('road.controller', STRUCTURE_ROAD)) return;

  if (this.room.controller.level == 0) {
    // If we're waiting for a claim, busy ourselves by building roads.
    if (this.buildPlannedStructures('road', STRUCTURE_ROAD)) return;
  }

  if (this.room.controller.level < 2) return;

  // At level 2, we can start building containers at sources and controller.
  this.removeUnplannedStructures('container', STRUCTURE_CONTAINER);
  if (this.buildPlannedStructures('container.source', STRUCTURE_CONTAINER)) return;
  if (this.buildPlannedStructures('container.controller', STRUCTURE_CONTAINER)) return;

  // Make sure towers are built in the right place, remove otherwise.
  this.removeUnplannedStructures('tower', STRUCTURE_TOWER, 1);
  if (this.buildPlannedStructures('tower', STRUCTURE_TOWER)) return;

  // Make sure extensions are built in the right place, remove otherwise.
  this.removeUnplannedStructures('extension', STRUCTURE_EXTENSION, 1);
  if (this.buildPlannedStructures('extension', STRUCTURE_EXTENSION)) return;

  // Build storage ASAP.
  if (this.buildPlannedStructures('storage', STRUCTURE_STORAGE)) return;

  // Also build terminal when available.
  if (this.buildPlannedStructures('terminal', STRUCTURE_TERMINAL)) return;

  // Make sure links are built in the right place, remove otherwise.
  this.removeUnplannedStructures('link', STRUCTURE_LINK, 1);
  if (this.buildPlannedStructures('link', STRUCTURE_LINK)) return;

  // Build extractor and related container if available.
  if (CONTROLLER_STRUCTURES[STRUCTURE_EXTRACTOR][this.room.controller.level] > 0) {
    if (this.buildPlannedStructures('extractor', STRUCTURE_EXTRACTOR)) return;
    if (this.buildPlannedStructures('container.mineral', STRUCTURE_CONTAINER)) return;
  }

  if (this.room.controller.level < 3) return;

  // At level 3, we can build all remaining roads.
  if (this.buildPlannedStructures('road', STRUCTURE_ROAD)) return;

  if (this.room.controller.level < 4) return;

  // Make sure all requested ramparts are built.
  var wallsBuilt = true;

  for (let posName in this.memory.locations.rampart || []) {
    let pos = utilities.decodePosition(posName);

    let found = false;
    // Check if there's a rampart here already.
    let structures = pos.lookFor(LOOK_STRUCTURES);
    for (let i in structures) {
      if (structures[i].structureType == STRUCTURE_RAMPART) {
        found = true;

        if (structures[i].hits < 500000) {
          wallsBuilt = false;
        }
        break;
      }
    }

    // Check if there's a construction site here already.
    let sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
    for (let i in sites) {
      if (sites[i].structureType == STRUCTURE_RAMPART) {
        found = true;
        break;
      }
    }

    if (!found) {
      wallsBuilt = false;

      if (this.newStructures + roomConstructionSites.length < 5 && _.size(Game.constructionSites) < MAX_CONSTRUCTION_SITES * 0.8) {
        if (pos.createConstructionSite(STRUCTURE_RAMPART) == OK) {
          this.newStructures++;
        }
      }
    }
  }

  // Further constructions should only happen in safe rooms.
  if (this.room && this.room.isEvacuating()) return;
  if (!wallsBuilt) return;
  hivemind.log('room plan', this.roomName).debug('walls are finished');

  // Slate all unmanaged walls and ramparts for deconstruction.
  var unwantedDefenses = this.room.find(FIND_STRUCTURES, {
    filter: (structure) => {
      if (structure.structureType == STRUCTURE_WALL) return true;
      if (structure.structureType == STRUCTURE_RAMPART) {
        // Keep rampart if it is one we have placed.
        let pos = utilities.encodePosition(structure.pos);
        if (this.memory.locations.rampart[pos]) return false;

        // Keep rampart if anything important is below it.
        let structures = structure.pos.lookFor(LOOK_STRUCTURES);
        for (let i in structures) {
          if (structures[i].structureType != STRUCTURE_RAMPART && structures[i].structureType != STRUCTURE_ROAD) {
            return false;
          }
        }
        return true;
      }
      return false;
    }
  });

  if (!this.memory.dismantle) {
    this.memory.dismantle = {};
  }
  for (let i in unwantedDefenses) {
    this.memory.dismantle[unwantedDefenses[i].id] = 1;
  }

  // Make sure labs are built in the right place, remove otherwise.
  this.removeUnplannedStructures('lab', STRUCTURE_LAB, 1);
  if (this.buildPlannedStructures('lab', STRUCTURE_LAB)) return;

  // Make sure all current nukers have been built.
  if (this.buildPlannedStructures('nuker', STRUCTURE_NUKER)) return;

  // Make sure all current power spawns have been built.
  if (this.buildPlannedStructures('powerSpawn', STRUCTURE_POWER_SPAWN)) return;

  // Make sure all current observers have been built.
  if (this.buildPlannedStructures('observer', STRUCTURE_OBSERVER)) return;
};

/**
 * Removes structures that might prevent the room's construction.
 */
RoomPlanner.prototype.cleanRoom = function () {
  // Remove all roads not part of current room plan.
  var roomRoads =  this.structuresByType[STRUCTURE_ROAD] || [];;
  for (let i = 0; i < roomRoads.length; i++) {
    let road = roomRoads[i];
    if (!this.memory.locations.road || !this.memory.locations.road[utilities.encodePosition(road.pos)]) {
      road.destroy();
    }
  }

  // Remove unwanted walls.
  var roomWalls =  this.structuresByType[STRUCTURE_WALL] || [];;
  for (let i = 0; i < roomWalls.length; i++) {
    let wall = roomWalls[i];
    if (this.memory.locations.road[utilities.encodePosition(wall.pos)]
      || this.memory.locations.spawn[utilities.encodePosition(wall.pos)]
      || this.memory.locations.storage[utilities.encodePosition(wall.pos)]
      || this.memory.locations.extension[utilities.encodePosition(wall.pos)]) {
      wall.destroy();
    }
  }

  // Remove hostile structures.
  let hostileStructures = this.room.find(FIND_HOSTILE_STRUCTURES);
  for (let i = 0; i < hostileStructures.length; i++) {
    hostileStructures[i].destroy();
  }
};

/**
 * Try placing construction sites of the given type at all locations.
 */
RoomPlanner.prototype.buildPlannedStructures = function (locationType, structureType) {
  let isBuilding = false;
  for (let posName in this.memory.locations[locationType] || []) {
    let pos = utilities.decodePosition(posName);

    if (!this.tryBuild(pos, structureType)) {
      isBuilding = true;
    }
  }

  return isBuilding;
};

/**
 * Tries to place a construction site.
 */
RoomPlanner.prototype.tryBuild = function (pos, structureType) {
  // Check if there's a structure here already.
  let structures = pos.lookFor(LOOK_STRUCTURES);
  for (let i in structures) {
    if (structures[i].structureType == structureType) {
      // Structure is here, continue.
      return true;
    }
  }

  // Check if there's a construction site here already.
  let sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
  for (let i in sites) {
    if (sites[i].structureType == structureType) {
      // Structure is being built, wait until finished.
      return false;
    }
  }

  if (this.newStructures + this.roomConstructionSites.length < 5 && _.size(Game.constructionSites) < MAX_CONSTRUCTION_SITES * 0.9) {
    if (pos.createConstructionSite(structureType) == OK) {
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
 * Remove structures that are not part of the current building plan.
 */
RoomPlanner.prototype.removeUnplannedStructures = function (locationType, structureType, amount) {
  let structures = this.structuresByType[structureType] || [];
  let sites = this.constructionSitesByType[structureType] || [];

  let limit = CONTROLLER_STRUCTURES[structureType][this.room.controller.level];
  if (amount) {
    limit = amount + structures.length + sites.length - limit;
  }

  let count = 0;
  if (this.memory.locations[locationType]) {
    for (let i = 0; i < structures.length; i++) {
      let structure = structures[i];
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

  for (let id in this.memory.dismantle) {
    let structure = Game.getObjectById(id);
    if (structure) {
      // If there's a rampart on it, dismantle the rampart first if requested, or just destroy the building immediately.
      let structures = structure.pos.lookFor(LOOK_STRUCTURES);
      let innocentRampartFound = false;
      for (let i in structures) {
        if (structures[i].structureType == STRUCTURE_RAMPART) {
          if (this.memory.dismantle[structures[i].id]) {
            return structures[i];
          }
          else {
            structure.destroy();
            innocentRampartFound = true;
            break;
          }
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
  let posName = utilities.encodePosition(pos);

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
  var matrix = new PathFinder.CostMatrix();
  var exitMatrix = new PathFinder.CostMatrix();
  var terrain = new Room.Terrain(this.roomName);

  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      if (terrain.get(x, y) == TERRAIN_MASK_WALL) {
        matrix.set(x, y, 255);
        exitMatrix.set(x, y, 255);
        continue;
      }

      if (x == 0 || x == 49 || y == 0 || y == 49) {
        exitMatrix.set(x, y, 1);
      }

      let found = false;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          let ax = (x + dx < 0 ? 0 : (x + dx > 49 ? 49 : x + dx));
          let ay = (y + dy < 0 ? 0 : (y + dy > 49 ? 49 : y + dy));

          if ((ax != 0 || ay != 0) && terrain.get(ax, ay) == TERRAIN_MASK_WALL) {
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
        if (matrix.get(x, y) == 0) {
          let found = false;
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              let ax = (x + dx < 0 ? 0 : (x + dx > 49 ? 49 : x + dx));
              let ay = (y + dy < 0 ? 0 : (y + dy > 49 ? 49 : y + dy));

              if ((ax != 0 || ay != 0) && matrix.get(ax, ay) == currentDistance) {
                matrix.set(x, y, currentDistance + 1);
                done = false;
                found = true;
                break;
              }
            }
            if (found) break;
          }
        }
        if (exitMatrix.get(x, y) == 0) {
          let found = false;
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              let ax = (x + dx < 0 ? 0 : (x + dx > 49 ? 49 : x + dx));
              let ay = (y + dy < 0 ? 0 : (y + dy > 49 ? 49 : y + dy));

              if ((ax != 0 || ay != 0) && exitMatrix.get(ax, ay) == currentDistance) {
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
RoomPlanner.prototype.findTowerPositions = function (exits, matrix) {
  let positions = {
    N: {count: 0, tiles: []},
    E: {count: 0, tiles: []},
    S: {count: 0, tiles: []},
    W: {count: 0, tiles: []},
  };

  let terrain = new Room.Terrain(this.roomName);
  for (let x = 1; x < 49; x++) {
    for (let y = 1; y < 49; y++) {
      if (matrix.get(x, y) != 0 && matrix.get(x, y) != 10) continue;
      if (this.safetyMatrix.get(x, y) != 1) continue;
      if (terrain.get(x, y) == TERRAIN_MASK_WALL) continue;
      let score = 0;

      let tileDir;
      if (x > y) {
        // Northeast.
        if (49 - x > y) tileDir = 'N'
        else tileDir = 'E';
      }
      else {
        // Southwest.
        if (49 - x > y) tileDir = 'W'
        else tileDir = 'S';
      }

      // No need to check in directions where there is no exit.
      if (_.size(exits[tileDir]) == 0) continue;

      // Don't count exits toward "safe" rooms or dead ends.
      if (this.memory.adjacentSafe && this.memory.adjacentSafe[tileDir]) continue;

      for (let dir in exits) {
        // Don't score distance to exits toward "safe" rooms or dead ends.
        if (this.memory.adjacentSafe && this.memory.adjacentSafe[dir]) continue;

        for (let i in exits[dir]) {
          score += 1 / exits[dir][i].getRangeTo(x, y);
        }
      }

      positions[tileDir].tiles.push({
        score: score,
        pos: new RoomPosition(x, y, this.roomName),
      });
    }
  }

  return positions;
};

/**
 * Makes plans for a room and place flags to visualize.
 */
RoomPlanner.prototype.placeFlags = function (visible) {
  // @todo Place some ramparts on spawns and maybe towers as a last protection if walls go down.
  var start = Game.cpu.getUsed();

  if (!this.memory.wallDistanceMatrix) {
    this.generateDistanceMatrixes();
    return;
  }

  // Reset location memory, to be replaced with new flags.
  this.memory.locations = {};

  let wallDistanceMatrix = PathFinder.CostMatrix.deserialize(this.memory.wallDistanceMatrix);
  let exitDistanceMatrix = PathFinder.CostMatrix.deserialize(this.memory.exitDistanceMatrix);
  this.wallDistanceMatrix = wallDistanceMatrix;
  this.exitDistanceMatrix = exitDistanceMatrix;

  // Prepare CostMatrix and exit points.
  var matrix = new PathFinder.CostMatrix();
  this.buildingMatrix = matrix;
  let exits = {
    N: [],
    S: [],
    W: [],
    E: [],
  };
  let walls = [];
  let roads = [];
  this.roads = roads;
  let centerPositions = [];
  let terrain = new Room.Terrain(this.roomName);
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      // Treat exits as unwalkable for in-room pathfinding.
      if (x == 0 || y == 0 || x == 49 || y == 49) {
        if (terrain.get(x, y) != TERRAIN_MASK_WALL) {
          if (x == 0) {
            exits.W.push(new RoomPosition(x, y, this.roomName));
          }
          if (x == 49) {
            exits.E.push(new RoomPosition(x, y, this.roomName));
          }
          if (y == 0) {
            exits.N.push(new RoomPosition(x, y, this.roomName));
          }
          if (y == 49) {
            exits.S.push(new RoomPosition(x, y, this.roomName));
          }
        }

        matrix.set(x, y, 255);
        continue;
      }

      // Avoid pathfinding close to walls to keep space for dodging and building / wider roads.
      let wallDistance = wallDistanceMatrix.get(x, y);
      let exitDistance = exitDistanceMatrix.get(x, y);

      if (wallDistance == 1) {
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

      if (exitDistance == 3) {
        matrix.set(x, y, 10);
        walls.push(new RoomPosition(x, y, this.roomName));
      }
    }
  }

  // Decide where exit regions are and where walls should be placed.
  let exitCenters = {};
  for (let dir in exits) {
    exitCenters[dir] = [];

    let startPos = null;
    let prevPos = null;
    for (let i in exits[dir]) {
      let pos = exits[dir][i];

      if (!startPos) {
        startPos = pos;
      }
      if (prevPos && pos.getRangeTo(prevPos) > 1) {
        // New exit block started.
        let middlePos = new RoomPosition(Math.ceil((prevPos.x + startPos.x) / 2), Math.ceil((prevPos.y + startPos.y) / 2), this.roomName);
        exitCenters[dir].push(middlePos);

        startPos = pos;
      }
      prevPos = pos;
    }

    if (startPos) {
      // Finish last wall run.
      let middlePos = new RoomPosition(Math.ceil((prevPos.x + startPos.x) / 2), Math.ceil((prevPos.y + startPos.y) / 2), this.roomName);
      exitCenters[dir].push(middlePos);
    }

    for (let i in exitCenters[dir]) {
      this.placeFlag(exitCenters[dir][i], 'exit', null);
    }
  }

  // Decide where room center should be by averaging exit positions.
  let cx = 0;
  let cy = 0;
  let count = 0;
  for (let dir in exitCenters) {
    for (let i in exitCenters[dir]) {
      count++;
      cx += exitCenters[dir][i].x;
      cy += exitCenters[dir][i].y;
    }
  }
  cx = Math.floor(cx / count);
  cy = Math.floor(cy / count);

  // Find closest position with distance from walls around there.
  let roomCenter = (new RoomPosition(cx, cy, this.roomName)).findClosestByRange(centerPositions);
  this.roomCenter = roomCenter;
  this.placeFlag(roomCenter, 'center', null);

  // Do another flood fill pass from interesting positions to remove walls that don't protect anything.
  this.pruneWalls(walls, roomCenter, wallDistanceMatrix);

  // Actually place ramparts.
  for (let i in walls) {
    if (walls[i].isRelevant) {
      this.placeFlag(walls[i], 'rampart', null);
    }
  }

  // Center is accessible via the 4 cardinal directions.
  let centerEntrances = [
    new RoomPosition(roomCenter.x + 2, roomCenter.y, this.roomName),
    new RoomPosition(roomCenter.x - 2, roomCenter.y, this.roomName),
    new RoomPosition(roomCenter.x, roomCenter.y + 2, this.roomName),
    new RoomPosition(roomCenter.x, roomCenter.y - 2, this.roomName),
  ];
  this.roomCenterEntrances = centerEntrances;

  // Find paths from each exit towards the room center for making roads.
  for (let dir in exitCenters) {
    for (let i in exitCenters[dir]) {
      this.scanAndAddRoad(exitCenters[dir][i], centerEntrances, matrix, roads);
    }
  }

  let planner = this;
  let tileFreeForBuilding = function(x, y, allowRoads) { return planner.isBuildableTile(x, y, allowRoads) };

  let placeLink = function (sourceRoads) {
    let linkPlaced = false;
    for (let i in sourceRoads) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx == 0 && dy == 0) continue;

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
  }

  let placeContainer = function (sourceRoads, containerType) {
    let targetPos = null;
    if (tileFreeForBuilding(sourceRoads[1].x, sourceRoads[1].y, true)) {
      targetPos = sourceRoads[1];
    }
    else if (tileFreeForBuilding(sourceRoads[0].x, sourceRoads[0].y, true)) {
      targetPos = sourceRoads[0];
    }
    else {
      for (let i in sourceRoads) {
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
  }

  if (this.room) {
    // @todo Have intelManager save locations (not just IDs) of sources, minerals and controller, so we don't need room access here.
    // We also save which road belongs to which path, so we can selectively autobuild roads during room bootstrap instead of building all roads at once.
    if (this.room.controller) {
      let controllerRoads = this.scanAndAddRoad(this.room.controller.pos, centerEntrances, matrix, roads);
      for (let i in controllerRoads) {
        if (i == 0) continue;
        this.placeFlag(controllerRoads[i], 'road.controller', null);
      }
      placeContainer(controllerRoads, 'controller');

      // Place a link near controller, but off the calculated path.
      placeLink(controllerRoads);
    }

    if (this.room.mineral) {
      this.placeFlag(this.room.mineral.pos, 'extractor');
      let mineralRoads = this.scanAndAddRoad(this.room.mineral.pos, centerEntrances, matrix, roads);
      for (let i in mineralRoads) {
        this.placeFlag(mineralRoads[i], 'road.mineral', null);
      }
      placeContainer(mineralRoads, 'mineral');

      // Make sure no other paths get led through harvester position.
      matrix.set(mineralRoads[0].x, mineralRoads[0].y, 255);
    }

    if (this.room.sources) {
      for (let i in this.room.sources) {
        let sourceRoads = this.scanAndAddRoad(this.room.sources[i].pos, centerEntrances, matrix, roads);
        for (let i in sourceRoads) {
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

  for (let i in roads) {
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

  // Determine where towers should be.
  let positions = this.findTowerPositions(exits, matrix);
  while (this.canPlaceMore('tower')) {
    let info = null;
    let bestDir = null;
    for (let dir in positions) {
      for (let i in positions[dir].tiles) {
        let tile = positions[dir].tiles[i];
        if (!info || positions[bestDir].count > positions[dir].count || (info.score < tile.score && positions[bestDir].count == positions[dir].count)) {
          info = tile;
          bestDir = dir;
        }
      }
    }

    if (!info) break;

    info.score = -1;

    // Make sure it's possible to refill this tower.
    let result = PathFinder.search(info.pos, this.roomCenterEntrances, {
      roomCallback: (roomName) => matrix,
      maxRooms: 1,
      plainCost: 1,
      swampCost: 1, // We don't care about cost, just about possibility.
    });
    if (result.incomplete) continue;

    positions[bestDir].count++;
    this.placeFlag(new RoomPosition(info.pos.x, info.pos.y, info.pos.roomName), 'tower');
  }

  // Also create roads to all towers.
  for (let posName in this.memory.locations.tower || []) {
    let pos = utilities.decodePosition(posName);

    this.placeAccessRoad(pos);
  }

  var end = Game.cpu.getUsed();
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
  let nextPos = this.getNextAvailableBuildSpot();
  if (!nextPos) return;

  let flagKey = 'Helper:' + nextPos.roomName;
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
    let nextPos = this.getNextAvailableBuildSpot();
    if (!nextPos) break;

    // Don't build too close to exits.
    if (this.exitDistanceMatrix.get(nextPos.x, nextPos.y) < 8) continue;

    if (!this.isBuildableTile(nextPos.x, nextPos.y)) continue;
    if (!this.isBuildableTile(nextPos.x - 1, nextPos.y)) continue;
    if (!this.isBuildableTile(nextPos.x + 1, nextPos.y)) continue;
    if (!this.isBuildableTile(nextPos.x, nextPos.y - 1)) continue;
    if (!this.isBuildableTile(nextPos.x, nextPos.y + 1)) continue;
    if (!this.isBuildableTile(nextPos.x - 1, nextPos.y - 1)) continue;
    if (!this.isBuildableTile(nextPos.x + 1, nextPos.y - 1)) continue;
    if (!this.isBuildableTile(nextPos.x - 1, nextPos.y + 1)) continue;
    if (!this.isBuildableTile(nextPos.x + 1, nextPos.y + 1)) continue;

    this.placeAccessRoad(nextPos);

    // Make sure there is a road in the center of the bay.
    this.placeFlag(nextPos, 'road', 1);

    // Fill other unused spots with extensions.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (!this.isBuildableTile(nextPos.x + dx, nextPos.y + dy)) continue;

        this.placeFlag(new RoomPosition(nextPos.x + dx, nextPos.y + dy, nextPos.roomName), 'extension');
      }
    }

    // Place a flag to mark this bay.
    let flagKey = 'Bay:' + nextPos.roomName + ':' + bayCount;
    if (Game.flags[flagKey]) {
      Game.flags[flagKey].setPosition(nextPos);
    }
    else {
      nextPos.createFlag(flagKey);
    }
    bayCount++;

    // Reinitialize pathfinding.
    this.startBuildingPlacement();
  }

  // Remove other bay flags in room that might be left over.
  for (let i = bayCount; i < 30; i++) {
    let flagKey = 'Bay:' + this.roomName + ':' + i;
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
    let nextPos = this.getNextAvailableBuildSpot();
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
 * Places all remaining structures of a given type.
 */
RoomPlanner.prototype.placeAll = function (structureType, addRoad) {
  while (this.canPlaceMore(structureType)) {
    let nextPos = this.getNextAvailableBuildSpot();
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
  let accessRoads = this.scanAndAddRoad(position, this.roomCenterEntrances, this.buildingMatrix, this.roads);
  for (let i in accessRoads) {
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
  let startPath = {};
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
    for (let posName in this.openList) {
      let info = this.openList[posName];
      let pos = utilities.decodePosition(posName);
      if (!minDist || info.range < minDist) {
        minDist = info.range;
        nextPos = pos;
        nextInfo = info;
      }
    }

    if (!nextPos) {
      break;
    }
    delete this.openList[utilities.encodePosition(nextPos)];
    this.closedList[utilities.encodePosition(nextPos)] = true;

    // Add unhandled adjacent tiles to open list.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx == 0 && dy == 0) continue;
        let pos = new RoomPosition(nextPos.x + dx, nextPos.y + dy, this.roomName);

        if (!this.isBuildableTile(pos.x, pos.y, true)) continue;

        let posName = utilities.encodePosition(pos);
        if (this.openList[posName] || this.closedList[posName]) continue;

        let newPath = {};
        for (let oldPos in nextInfo.path) {
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

    return nextPos;
  }
};

/**
 * Checks if a structure can be placed on the given tile.
 */
RoomPlanner.prototype.isBuildableTile = function (x, y, allowRoads) {
  // Only build on valid terrain.
  if (this.wallDistanceMatrix.get(x, y) > 100) return false;

  // Don't build too close to exits.
  if (this.exitDistanceMatrix.get(x, y) < 6) return false;

  let matrixValue = this.buildingMatrix.get(x, y);
  // Can't build on other buildings.
  if (matrixValue > 100) return false;

  // Tiles next to walls are fine for building, just not so much for pathing.
  if (matrixValue == 10 && this.wallDistanceMatrix.get(x, y) == 1) return true;

  // @todo Find out why this check was initially introduced.
  if (matrixValue > 1) return false;

  // Don't build on roads if not allowed.
  if (matrixValue == 1 && !allowRoads) return false;

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
  for (let posName in this.openList) {
    if (this.openList[posName].path[targetPos]) {
      delete this.openList[posName];
    }
  }
};

/**
 * Removes any walls that can not be reached from the given list of coordinates.
 */
RoomPlanner.prototype.pruneWallFromTiles = function (walls, wallDistanceMatrix, tiles, onlyRelevant) {
  var openList = {};
  var closedList = {};
  let safetyValue = 1;

  for (var i in tiles) {
    openList[tiles[i]] = true;
  }

  // If we're doing an additionall pass, unmark walls first.
  if (onlyRelevant) {
    safetyValue = 2;
    for (var i in walls) {
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
    for (let posName in openList) {
      let pos = utilities.decodePosition(posName);
      nextPos = pos;
      break;
    }

    // Record which tiles are safe or unsafe.
    this.safetyMatrix.set(nextPos.x, nextPos.y, safetyValue);

    delete openList[utilities.encodePosition(nextPos)];
    closedList[utilities.encodePosition(nextPos)] = true;

    // Add unhandled adjacent tiles to open list.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx == 0 && dy == 0) continue;
        let pos = new RoomPosition(nextPos.x + dx, nextPos.y + dy, this.roomName);
        if (pos.x < 1 || pos.x > 48 || pos.y < 1 || pos.y > 48) continue;

        // Ignore walls.
        if (wallDistanceMatrix.get(pos.x, pos.y) > 100) continue;

        let posName = utilities.encodePosition(pos);
        if (openList[posName] || closedList[posName]) continue;

        // If there's a rampart to be built there, mark it and move on.
        var wallFound = false;
        for (var i in walls) {
          if (walls[i].x == pos.x && walls[i].y == pos.y) {
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
}

/**
 * Marks all walls which are adjacent to the "inner area" of the room.
 */
RoomPlanner.prototype.pruneWalls = function (walls, roomCenter, wallDistanceMatrix) {
  this.safetyMatrix = new PathFinder.CostMatrix();

  var openList = [];
  openList.push (utilities.encodePosition(roomCenter));
  // @todo Include sources, minerals, controller.
  if (this.room) {
    openList.push(utilities.encodePosition(this.room.controller.pos));
    var sources = this.room.find(FIND_SOURCES);
    for (var i in sources) {
      openList.push(utilities.encodePosition(sources[i].pos));
    }
    var minerals = this.room.find(FIND_MINERALS);
    for (var i in sources) {
      openList.push(utilities.encodePosition(sources[i].pos));
    }
  }
  this.pruneWallFromTiles(walls, wallDistanceMatrix, openList);

  // Do a second pass, checking which walls get touched by unsafe exits.

  // Prepare CostMatrix and exit points.
  let exits = [];
  let terrain = new Room.Terrain(this.roomName);

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
      if (this.safetyMatrix.get(x, y) != 2) continue;

      for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -3; dy <= 3; dy++) {
          if (dx == 0 && dy == 0) continue;
          if (x + dx < 0 || x + dx > 49 || y + dy < 0 || y + dy > 49) continue;
          if (this.safetyMatrix.get(x + dx, y + dy) == 1) {
            // Safe tile in range of an unsafe tile, mark as neutral.
            this.safetyMatrix.set(x + dx, y + dy, 0);
          }
        }
      }
    }
  }
}

RoomPlanner.prototype.scanAndAddRoad = function (from, to, matrix, roads) {
  let result = PathFinder.search(from, to, {
    roomCallback: (roomName) => matrix,
    maxRooms: 1,
    plainCost: 2,
    swampCost: 2, // Swamps are more expensive to build roads on, but once a road is on them, creeps travel at the same speed.
    heuristicWeight: 0.9,
  });

  let newRoads = [];
  if (result.path) {
    for (let j in result.path) {
      let pos = result.path[j];
      roads.push(pos);
      newRoads.push(pos);

      // Since we're building a road on this tile anyway, prefer it for future pathfinding.
      matrix.set(pos.x, pos.y, 1);
    }
  }

  return newRoads;
}

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

  let newStatus = {
    N: false,
    E: false,
    S: false,
    W: false,
  };

  let dirMap = {
    1: 'N',
    3: 'E',
    5: 'S',
    7: 'W',
  }

  // @todo Do processing.
  if (this.room.memory.intel) {
    let intel = this.room.memory.intel;

    newStatus = {
      N: true,
      E: true,
      S: true,
      W: true,
    };

    let openList = {};
    let closedList = {};
    let joinedDirs = {};
    // Add initial directions to open list.
    for (let moveDir in intel.exits || []) {
      let dir = dirMap[moveDir];
      let roomName = intel.exits[moveDir];

      if (Game.rooms[roomName] && Game.rooms[roomName].controller && Game.rooms[roomName].controller.my) {
        // This is one of our own rooms, and as such is safe.
        if ((Game.rooms[roomName].controller.level >= Math.min(5, this.room.controller.level - 1)) && !Game.rooms[roomName].isEvacuating()) {
          continue;
        }
      }

      openList[roomName] = {
        range: 1,
        origin: dir,
        room: roomName,
      };
    }

    // Process adjacent rooms until range has been reached.
    while (_.size(openList) > 0) {
      let minRange = null;
      for (let roomName in openList) {
        if (!minRange || minRange.range > openList[roomName].range) {
          minRange = openList[roomName];
        }
      }

      delete openList[minRange.room];
      closedList[minRange.room] = minRange;

      if (Memory.rooms[minRange.room] && Memory.rooms[minRange.room].intel) {
        let roomIntel = Memory.rooms[minRange.room].intel;
        // Add new adjacent rooms to openList if available.
        for (let moveDir in roomIntel.exits || []) {
          let roomName = roomIntel.exits[moveDir];

          if (minRange.range >= 3) {
            // Room has open exits more than 3 rooms away.
            // Mark as unsafe.
            newStatus[minRange.origin] = false;
            break;
          }

          let found = openList[roomName] || closedList[roomName] || false;
          if (found) {
            if (found.origin != minRange.origin) {
              // Two different exit directions are joined here.
              // Treat them as the same.
              if (!joinedDirs[found.origin]) {
                joinedDirs[found.origin] = {};
              }
              joinedDirs[found.origin][minRange.origin] = true;
            }
            continue;
          }

          if (Game.rooms[roomName] && Game.rooms[roomName].controller && Game.rooms[roomName].controller.my) {
            // This is one of our own rooms, and as such is safe.
            if (Game.rooms[roomName].controller.level >= 5 && !Game.rooms[roomName].isEvacuating() || roomName == this.room.name) {
              continue;
            }
          }

          // Room has not been checked yet.
          openList[roomName] = {
            range: minRange.range + 1,
            origin: minRange.origin,
            room: roomName,
          };
        }
      }
      else {
        // Room has no intel, declare it as unsafe.
        newStatus[minRange.origin] = false;
      }
    }

    // Unify status of directions which meet up somewhere.
    for (let dir1 in joinedDirs) {
      for (let dir2 in joinedDirs[dir1]) {
        newStatus[dir1] = newStatus[dir1] && newStatus[dir2];
        newStatus[dir2] = newStatus[dir1] && newStatus[dir2];
      }
    }

    // Keep a list of rooms declared as safe in memory.
    this.memory.adjacentSafeRooms = [];
    for (let roomName in closedList) {
      let roomDir = closedList[roomName].origin;
      if (newStatus[roomDir]) {
        this.memory.adjacentSafeRooms.push(roomName);
      }
    }
  }

  // Check if status changed since last check.
  for (let dir in newStatus) {
    if (newStatus[dir] != this.memory.adjacentSafe[dir]) {
      // Status has changed, recalculate building positioning.
      hivemind.log('room plan', this.roomName).debug('changed adjacent room status!');
      Game.notify(
        'Exit safety has changed for room ' + this.room.name + '!' + "\n\n" +
        'N: ' + (this.memory.adjacentSafe.N ? 'safe' : 'not safe') + ' -> ' + (newStatus.N ? 'safe' : 'not safe') + "\n" +
        'E: ' + (this.memory.adjacentSafe.E ? 'safe' : 'not safe') + ' -> ' + (newStatus.E ? 'safe' : 'not safe') + "\n" +
        'S: ' + (this.memory.adjacentSafe.S ? 'safe' : 'not safe') + ' -> ' + (newStatus.S ? 'safe' : 'not safe') + "\n" +
        'W: ' + (this.memory.adjacentSafe.W ? 'safe' : 'not safe') + ' -> ' + (newStatus.W ? 'safe' : 'not safe') + "\n"
      );
      delete this.memory.locations;
      this.memory.adjacentSafe = newStatus;
      break;
    }
  }
};

RoomPlanner.prototype.getAdjacentSafeRooms = function () {
  return this.memory.adjacentSafeRooms || [];
};

module.exports = RoomPlanner;
