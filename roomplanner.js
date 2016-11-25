var utilities = require('utilities');

var RoomPlanner = function (roomName) {
  this.roomName = roomName;
  this.room = Game.rooms[roomName]; // Will not always be available.

  if (!Memory.rooms[roomName]) {
    Memory.rooms[roomName] = {};
  }
  if (!Memory.rooms[roomName].roomPlanner) {
    Memory.rooms[roomName].roomPlanner = {};
  }
  this.memory = Memory.rooms[roomName].roomPlanner;

  // Automatically assume control over any room.
  this.memory.controlRoom = true;
};

/**
 * Gives a the roomplanner control over a room, or takes it away.
 */
RoomPlanner.prototype.controlRoom = function (giveControl) {
  this.memory.controlRoom = giveControl;
};

/**
 *
 */
RoomPlanner.prototype.tryBuild = function (pos, structureType, roomConstructionSites) {
  // Check if there's a structure here already.
  let structures = pos.lookFor(LOOK_STRUCTURES);
  for (let i in structures) {
    if (structures[i].structureType == structureType) {
      return true;
    }
  }

  // Check if there's a construction site here already.
  let sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
  for (let i in sites) {
    if (sites[i].structureType == structureType) {
      return false;
    }
  }

  if (this.newStructures + roomConstructionSites.length < 5 && _.size(Game.constructionSites) < MAX_CONSTRUCTION_SITES * 0.8) {
    if (pos.createConstructionSite(structureType) == OK) {
      this.newStructures++;
    }
  }

  return false;
};

/**
 * Allows this room planner to give commands in controlled rooms.
 */
RoomPlanner.prototype.runLogic = function () {
  if (Game.cpu.bucket < 3500) return;
  if (!this.memory.controlRoom) return;
  if (!this.memory.locations) {
    if (Game.cpu.getUsed() < 100) {
      this.placeFlags();
    }
    return;
  }
  if (Game.time % 100 != 3) return;

  //console.log('[RoomPlanner]', 'running logic in', this.roomName);

  if (this.room.controller.level < 2) return;
  var roomConstructionSites = this.room.find(FIND_MY_CONSTRUCTION_SITES);
  this.newStructures = 0;
  let doneBuilding = true;

  // @todo Make sure all current extensions have been built.

  // At level 2, we can start building containers and roads to sources.
  for (let posName in this.memory.locations['container.source'] || []) {
    let pos = utilities.decodePosition(posName);

    if (!this.tryBuild(pos, STRUCTURE_CONTAINER, roomConstructionSites)) {
      doneBuilding = false;
    }
  }
  if (!doneBuilding) return;

  for (let posName in this.memory.locations['road.source'] || []) {
    let pos = utilities.decodePosition(posName);

    if (!this.tryBuild(pos, STRUCTURE_ROAD, roomConstructionSites)) {
      doneBuilding = false;
    }
  }
  if (!doneBuilding) return;

  // Next priority is a container and road at the controller.
  for (let posName in this.memory.locations['container.controller'] || []) {
    let pos = utilities.decodePosition(posName);

    if (!this.tryBuild(pos, STRUCTURE_CONTAINER, roomConstructionSites)) {
      doneBuilding = false;
    }
  }
  if (!doneBuilding) return;

  for (let posName in this.memory.locations['road.controller'] || []) {
    let pos = utilities.decodePosition(posName);

    if (!this.tryBuild(pos, STRUCTURE_ROAD, roomConstructionSites)) {
      doneBuilding = false;
    }
  }
  if (!doneBuilding) return;

  if (this.room.controller.level < 3) return;
  // At level 3, we can build all remaining roads.
  for (let posName in this.memory.locations['road'] || []) {
    let pos = utilities.decodePosition(posName);

    if (!this.tryBuild(pos, STRUCTURE_ROAD, roomConstructionSites)) {
      doneBuilding = false;
    }
  }
  if (!doneBuilding) return;


  if (this.room.controller.level < 4) return;

  // Build storage. Finally!
  for (let posName in this.memory.locations['storage'] || []) {
    let pos = utilities.decodePosition(posName);

    if (!this.tryBuild(pos, STRUCTURE_STORAGE, roomConstructionSites)) {
      doneBuilding = false;
    }
  }
  if (!doneBuilding) return;

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

  if (!wallsBuilt) return;
  new Game.logger('roomplanner', this.roomName).debug('walls are finished');

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
};

/**
 * Decides whether a dismantler is needed in the current room.
 */
RoomPlanner.prototype.needsDismantling = function () {
  if (!this.memory.controlRoom) return false;
  if (_.size(this.memory.dismantle) > 0) {
    return true;
  }
  return false;
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
  if (!this.room.roomPlanner.needsDismantling()) return false;

  if (this.room.roomPlanner.memory.dismantle && this.room.roomPlanner.memory.dismantle[this.id]) {
    return true;
  }
  return false;
};

/**
 * Places a room planner flag of a certain type.
 */
RoomPlanner.prototype.placeFlag = function (pos, flagType, visible) {
  let posName = utilities.encodePosition(pos);

  if (!this.memory.locations) {
    this.memory.locations = {};
  }
  if (!this.memory.locations[flagType]) {
    this.memory.locations[flagType] = {};
  }
  this.memory.locations[flagType][posName] = 1;

  if (visible) {
    let flagName = 'RP:' + posName + ':' + flagType;

    let color = COLOR_WHITE;
    let color2 = COLOR_WHITE;

    if (flagType == 'wall') {
      color = COLOR_GREY;
      color2 = COLOR_GREY;
    }
    else if (flagType == 'rampart') {
      color = COLOR_GREY;
      color2 = COLOR_GREEN;
    }
    else if (flagType == 'road') {
      color = COLOR_GREY;
      color2 = COLOR_WHITE;
    }
    else if (flagType == 'exit') {
      color = COLOR_RED;
      color2 = COLOR_RED;
    }
    else if (flagType == 'center') {
      color = COLOR_GREEN;
      color2 = COLOR_GREEN;
    }
    else if (flagType == 'test') {
      color = COLOR_YELLOW;
      color2 = COLOR_GREY;
    }

    if (Game.flags[flagName]) {
      Game.flags[flagName].setColor(color, color2);
    }
    else {
      pos.createFlag(flagName, color, color2);
    }
  }
};

/**
 * Generates CostMatrixes needed for structure placement.
 */
RoomPlanner.prototype.generateDistanceMatrixes = function () {
  var matrix = new PathFinder.CostMatrix();
  var exitMatrix = new PathFinder.CostMatrix();

  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      let terrain = Game.map.getTerrainAt(x, y, this.roomName);

      if (terrain == 'wall') {
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

          if ((ax != 0 || ay != 0) && Game.map.getTerrainAt(ax, ay, this.roomName) == 'wall') {
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
 * Makes plans for a room and place flags to visualize.
 */
RoomPlanner.prototype.placeFlags = function (visible) {
  var start = Game.cpu.getUsed();

  if (!this.memory.wallDistanceMatrix) {
    this.generateDistanceMatrixes();
    return;
  }

  // Reset location memory, to be replaced with new flags.
  this.memory.locations = {};

  let wallDistanceMatrix = PathFinder.CostMatrix.deserialize(this.memory.wallDistanceMatrix);
  let exitDistanceMatrix = PathFinder.CostMatrix.deserialize(this.memory.exitDistanceMatrix);

  // Prepare CostMatrix and exit points.
  var matrix = new PathFinder.CostMatrix();
  let exits = {
    N: [],
    S: [],
    W: [],
    E: [],
  };
  let walls = [];
  let roads = [];
  let centerPositions = [];
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      let terrain = Game.map.getTerrainAt(x, y, this.roomName);

      // Treat exits as unwalkable for in-room pathfinding.
      if (x == 0 || y == 0 || x == 49 || y == 49) {
        if (terrain != 'wall') {
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

      if (exitDistance >= 2 && exitDistance <= 5) {
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
      this.placeFlag(exitCenters[dir][i], 'exit', visible);
    }
  }

  for (let i in walls) {
    this.placeFlag(walls[i], 'rampart', visible);
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
  this.placeFlag(roomCenter, 'center', visible);

  // Center is accessible via the 4 cardinal directions.
  let centerEntrances = [
    new RoomPosition(roomCenter.x + 2, roomCenter.y, this.roomName),
    new RoomPosition(roomCenter.x - 2, roomCenter.y, this.roomName),
    new RoomPosition(roomCenter.x, roomCenter.y + 2, this.roomName),
    new RoomPosition(roomCenter.x, roomCenter.y - 2, this.roomName),
  ];

  // Find paths from each exit towards the room center for making roads.
  for (let dir in exitCenters) {
    for (let i in exitCenters[dir]) {
      this.scanAndAddRoad(exitCenters[dir][i], centerEntrances, matrix, roads);
    }
  }

  if (this.room) {
    // @todo Have intelManager save locations (not just IDs) of sources, minerals and controller, so we don't need room access here.
    // We also save which road belongs to which path, so we can selectively autobuild roads during room bootstrap instead of building all roads at once.
    if (this.room.controller) {
      let contollerRoads = this.scanAndAddRoad(this.room.controller.pos, centerEntrances, matrix, roads);
      for (let i in contollerRoads) {
        this.placeFlag(contollerRoads[i], 'road.controller', visible);
      }
      this.placeFlag(contollerRoads[1], 'container.controller', visible);
    }

    if (this.room.mineral) {
      let mineralRoads = this.scanAndAddRoad(this.room.mineral.pos, centerEntrances, matrix, roads);
      for (let i in mineralRoads) {
        this.placeFlag(mineralRoads[i], 'road.mineral', visible);
      }
      this.placeFlag(mineralRoads[1], 'container.mineral', visible);
    }

    if (this.room.sources) {
      for (let i in this.room.sources) {
        let sourceRoads = this.scanAndAddRoad(this.room.sources[i].pos, centerEntrances, matrix, roads);
        for (let i in sourceRoads) {
          this.placeFlag(sourceRoads[i], 'road.source', visible);
        }
        this.placeFlag(sourceRoads[1], 'container.source', visible);
      }
    }
  }

  for (let i in roads) {
    this.placeFlag(roads[i], 'road', visible);
  }

  // Fill center cross with roads.
  this.placeFlag(new RoomPosition(roomCenter.x - 1, roomCenter.y, this.roomName), 'road', visible);
  matrix.set(roomCenter.x - 1, roomCenter.y, 1);
  this.placeFlag(new RoomPosition(roomCenter.x + 1, roomCenter.y, this.roomName), 'road', visible);
  matrix.set(roomCenter.x + 1, roomCenter.y, 1);
  this.placeFlag(new RoomPosition(roomCenter.x, roomCenter.y - 1, this.roomName), 'road', visible);
  matrix.set(roomCenter.x, roomCenter.y - 1, 1);
  this.placeFlag(new RoomPosition(roomCenter.x, roomCenter.y + 1, this.roomName), 'road', visible);
  matrix.set(roomCenter.x, roomCenter.y + 1, 1);
  this.placeFlag(new RoomPosition(roomCenter.x, roomCenter.y, this.roomName), 'road', visible);
  matrix.set(roomCenter.x, roomCenter.y, 1);

  // Mark center buildings for construction.
  this.placeFlag(new RoomPosition(roomCenter.x - 1, roomCenter.y + 1, this.roomName), 'storage', visible);
  matrix.set(roomCenter.x - 1, roomCenter.y + 1, 255);
  this.placeFlag(new RoomPosition(roomCenter.x - 1, roomCenter.y - 1, this.roomName), 'terminal', visible);
  matrix.set(roomCenter.x - 1, roomCenter.y - 1, 255);
  this.placeFlag(new RoomPosition(roomCenter.x + 1, roomCenter.y + 1, this.roomName), 'lab', visible);
  matrix.set(roomCenter.x + 1, roomCenter.y + 1, 255);
  this.placeFlag(new RoomPosition(roomCenter.x + 1, roomCenter.y - 1, this.roomName), 'link', visible);
  matrix.set(roomCenter.x + 1, roomCenter.y - 1, 255);

  // Flood fill from the center to place buildings that need to be accessible.
  // @todo Decide position of spawns.
  var openList = {};
  openList[utilities.encodePosition(roomCenter)] = true;
  var closedList = {};
  var buildingsPlaced = false;
  console.log('starting flood fill');
  while (!buildingsPlaced && _.size(openList) > 0) {
    //console.log('.');
    let minDist = null;
    let nextPos = null;
    for (let posName in openList) {
      let pos = utilities.decodePosition(posName);
      let range = pos.getRangeTo(roomCenter);
      if (!minDist || range < minDist) {
        minDist = range;
        nextPos = pos;
      }
    }

    if (!nextPos) {
      console.log('no more elements in open list');
      break;
    }
    delete openList[utilities.encodePosition(nextPos)];
    closedList[utilities.encodePosition(nextPos)] = true;

    // Add unhandled adjacent tiles to open list.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx == 0 && dy == 0) continue;
        let pos = new RoomPosition(nextPos.x + dx, nextPos.y + dy, this.roomName);
        if (pos.x < 1 || pos.x > 48 || pos.y < 1 || pos.y > 48) continue;

        // Only build on valid terraint.
        if (wallDistanceMatrix.get(pos.x, pos.y) < 1) continue;

        // Don't build too close to exits.
        if (exitDistanceMatrix.get(pos.x, pos.y) < 5) continue;

        let posName = utilities.encodePosition(pos);
        if (openList[posName] || closedList[posName]) continue;
        //console.log('openList', pos.x, pos.y);
        openList[posName] = true;
      }
    }

    // Handle current position.
    if (nextPos.getRangeTo(roomCenter) < 3) continue;

    if (!this.memory.locations.spawn || _.size(this.memory.locations.spawn) < 3) {
      // Try placing spawns.
      if (matrix.get(nextPos.x, nextPos.y) != 0) continue;
      if (matrix.get(nextPos.x - 1, nextPos.y) > 1) continue;
      if (matrix.get(nextPos.x + 1, nextPos.y) > 1) continue;
      if (matrix.get(nextPos.x, nextPos.y - 1) > 1) continue;
      if (matrix.get(nextPos.x, nextPos.y + 1) > 1) continue;

      this.placeFlag(new RoomPosition(nextPos.x, nextPos.y, this.roomName), 'spawn', visible);
      matrix.set(nextPos.x, nextPos.y, 255);
      this.placeFlag(new RoomPosition(nextPos.x - 1, nextPos.y, this.roomName), 'road', visible);
      matrix.set(nextPos.x - 1, nextPos.y, 1);
      this.placeFlag(new RoomPosition(nextPos.x + 1, nextPos.y, this.roomName), 'road', visible);
      matrix.set(nextPos.x + 1, nextPos.y, 1);
      this.placeFlag(new RoomPosition(nextPos.x, nextPos.y - 1, this.roomName), 'road', visible);
      matrix.set(nextPos.x, nextPos.y - 1, 1);
      this.placeFlag(new RoomPosition(nextPos.x, nextPos.y + 1, this.roomName), 'road', visible);
      matrix.set(nextPos.x, nextPos.y + 1, 1);

      new Game.logger('roomplanner', this.roomName).debug('Placing new spawn at', nextPos);
    }
    else {
      buildingsPlaced = true;
    }
  }

  var end = Game.cpu.getUsed();
  console.log('Planning for', this.roomName, 'took', end - start, 'CPU');
};

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
  else {
    // @todo If a path does not exist, mark this center location as invalid and start over.
  }

  return newRoads;
}

/**
 * Clears all flags placed in a room by the room planner.
 */
RoomPlanner.prototype.clearFlags = function () {
  var flags = _.filter(Game.flags, (flag) => flag.pos.roomName == this.roomName && flag.name.startsWith('RP:'));

  for (let i in flags) {
    flags[i].remove();
  }
};

module.exports = RoomPlanner;
