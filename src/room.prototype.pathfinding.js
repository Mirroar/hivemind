'use strict';

let utilities = require('utilities');

Room.prototype.getCostMatrix = function () {
  return utilities.getCostMatrix(this.name);
};

/**
 * Generates a new CostMatrix for pathfinding in this room.
 */
Room.prototype.generateCostMatrix = function (structures, constructionSites) {
  let costs = new PathFinder.CostMatrix;

  if (!structures) {
    structures = this.find(FIND_STRUCTURES);
  }
  if (!constructionSites) {
    constructionSites = this.find(FIND_MY_CONSTRUCTION_SITES);
  }

  structures.forEach(function (structure) {
    if (structure.structureType === STRUCTURE_ROAD) {
      // Only do this if no structure is on the road.
      if (costs.get(structure.pos.x, structure.pos.y) <= 0) {
        // Favor roads over plain tiles.
        costs.set(structure.pos.x, structure.pos.y, 1);
      }
    } else if (structure.structureType !== STRUCTURE_CONTAINER && (structure.structureType !== STRUCTURE_RAMPART || !structure.my)) {
      // Can't walk through non-walkable buildings.
      costs.set(structure.pos.x, structure.pos.y, 0xff);
    }
  });

  constructionSites.forEach(function (structure) {
    if (structure.structureType !== STRUCTURE_ROAD && structure.structureType !== STRUCTURE_CONTAINER && structure.structureType !== STRUCTURE_RAMPART) {
      // Can't walk through non-walkable construction sites.
      costs.set(structure.pos.x, structure.pos.y, 0xff);
    }
  });

  return costs;
};

/**
 * Calculates a list of room names for traveling to a target room.
 */
Room.prototype.calculateRoomPath = function (targetRoom) {
  let roomName = this.name;

  let openList = {};
  let closedList = {};

  openList[roomName] = {
    range: 0,
    dist: Game.map.getRoomLinearDistance(roomName, targetRoom),
    origin: roomName,
    path: [],
  };

  // A* from here to targetRoom.
  // @todo Avoid unsafe rooms.
  let finalPath = null;
  while (_.size(openList) > 0) {
    let minDist = null;
    let nextRoom = null;
    for (let rName in openList) {
      let info = openList[rName];
      if (!minDist || info.range + info.dist < minDist) {
        minDist = info.range + info.dist;
        nextRoom = rName;
      }
    }

    if (!nextRoom) {
      break;
    }

    let info = openList[nextRoom];

    // We're done if we reached targetRoom.
    if (nextRoom == targetRoom) {
      finalPath = info.path;
    }

    // Add unhandled adjacent rooms to open list.
    if (Memory.rooms[nextRoom] && Memory.rooms[nextRoom].intel && Memory.rooms[nextRoom].intel.exits) {
      for (let i in Memory.rooms[nextRoom].intel.exits) {
        let exit = Memory.rooms[nextRoom].intel.exits[i];
        if (openList[exit] || closedList[exit]) continue;

        if (Memory.rooms[exit] && Memory.rooms[exit].intel) {
          let intel = Memory.rooms[exit].intel;
          if (intel.owner && intel.owner != utilities.getUsername()) continue;
          // @todo Allow pathing through source keeper rooms if we can safely avoid them.
          if (intel.structures && _.size(intel.structures[STRUCTURE_KEEPER_LAIR]) > 0) continue;
        }

        let path = [];
        for (let i in info.path) {
          path.push(info.path[i]);
        }
        path.push(exit);

        openList[exit] = {
          range: info.range + 1,
          dist: Game.map.getRoomLinearDistance(exit, targetRoom),
          origin: info.origin,
          path: path,
        };
      }
    }

    delete openList[nextRoom];
    closedList[nextRoom] = true;
  }

  return finalPath;
};

