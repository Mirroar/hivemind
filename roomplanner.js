var utilities = require('utilities');

var RoomPlanner = function (roomName) {
  this.roomName = roomName;

  if (!Memory.rooms[roomName]) {
    Memory.rooms[roomName] = {};
  }
  if (!Memory.rooms[roomName].roomPlanner) {
    Memory.rooms[roomName].roomPlanner = {};
  }
  this.memory = Memory.rooms[roomName].roomPlanner;

  console.log('room planner for', roomName, 'initialized.');
};

/**
 * Places a room planner flag of a certain type.
 */
RoomPlanner.prototype.placeFlag = function (pos, flagType) {
  let flagName = 'RP:' + utilities.encodePosition(pos) + ':' + flagType;

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
};

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
RoomPlanner.prototype.placeFlags = function () {
  var start = Game.cpu.getUsed();

  if (!this.memory.wallDistanceMatrix) {
    this.generateDistanceMatrixes();
    return;
  }
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
        console.log(prevPos, pos, pos.getRangeTo(prevPos));
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
      this.placeFlag(exitCenters[dir][i], 'exit');
    }
  }

  for (let i in walls) {
    this.placeFlag(walls[i], 'rampart');
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
  this.placeFlag(roomCenter, 'center');

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

  if (Game.rooms[this.roomName]) {
    // @todo Have intelManager save locations (not just IDs) of sources, minerals and controller, so we don't need room access here.
    let room = Game.rooms[this.roomName];

    if (room.controller) {
      this.scanAndAddRoad(room.controller.pos, centerEntrances, matrix, roads);
    }

    if (room.mineral) {
      this.scanAndAddRoad(room.mineral.pos, centerEntrances, matrix, roads);
    }

    if (room.sources) {
      for (let i in room.sources) {
        this.scanAndAddRoad(room.sources[i].pos, centerEntrances, matrix, roads);
      }
    }
  }

  for (let i in roads) {
    this.placeFlag(roads[i], 'road');
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

  if (result.path) {
    for (let j in result.path) {
      let pos = result.path[j];
      roads.push(pos);

      // Since we're building a road on this tile anyway, prefer it for future pathfinding.
      matrix.set(pos.x, pos.y, 1);
    }
  }
  else {
    // @todo If a path does not exist, mark this center location as invalid and start over.
  }
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
