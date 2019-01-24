'use strict';

var utilities = require('utilities');

var RoomIntel = function (roomName) {
  this.roomName = roomName;

  if (!Memory.rooms[roomName]) {
    Memory.rooms[roomName] = {};
  }
  if (!Memory.rooms[roomName].intel) {
    Memory.rooms[roomName].intel = {};
  }

  this.memory = Memory.rooms[roomName].intel;
};

/**
 * Returns number of ticks since intel on this room was last gathered.
 */
RoomIntel.prototype.getAge = function () {
  return Game.time - (this.memory.lastScan || 0);
};

/**
 * Checks whether this room could be claimed by a player.
 */
RoomIntel.prototype.isClaimable = function () {
  if (this.memory.hasController) return true;
};

/**
 * Checks whether this room is claimed by another player.
 *
 * This checks ownership and reservations.
 */
RoomIntel.prototype.isClaimed = function () {
  if (this.isOwned()) return true;
  if (this.memory.reservation && this.memory.reservation.username && this.memory.reservation.username != utilities.getUsername()) return true;

  return false;
};

/**
 * Checks if the room is owned by another player.
 */
RoomIntel.prototype.isOwned = function () {
  if (!this.memory.owner) return false;
  if (this.memory.owner != utilities.getUsername()) return true;

  return false;
};

/**
 * Returns this room's last known rcl level.
 */
RoomIntel.prototype.getRcl = function () {
  return this.memory.rcl || 0;
};

/**
 * Returns position of energy sources in the room.
 */
RoomIntel.prototype.getSourcePositions = function () {
  return this.memory.sources || [];
};

/**
 * Returns type of mineral source in the room, if available.
 */
RoomIntel.prototype.getMineralType = function () {
  return this.memory.mineralType;
};

/**
 * Returns a cost matrix for the given room.
 */
RoomIntel.prototype.getCostMatrix = function () {
  if (this.memory.costMatrix) return PathFinder.CostMatrix.deserialize(this.memory.costMatrix);
  if (Game.rooms[this.roomName]) return Game.rooms[this.roomName].generateCostMatrix();

  return new PathFinder.CostMatrix();
};

/**
 * Returns a list of rooms connected to this one, keyed by direction.
 */
RoomIntel.prototype.getExits = function () {
  return this.memory.exits || {};
};

/**
 * Returns position of the Controller structure in this room.
 */
RoomIntel.prototype.getControllerPosition = function () {
  if (!this.memory.structures || !this.memory.structures[STRUCTURE_CONTROLLER]) return;

  let controller = _.sample(this.memory.structures[STRUCTURE_CONTROLLER]);
  return new RoomPosition(controller.x, controller.y, this.roomName);
};

/**
 * Returns position and id of certain structures.
 */
RoomIntel.prototype.getStructures = function (structureType) {
  if (!this.memory.structures || !this.memory.structures[structureType]) return [];
  return this.memory.structures[structureType];
};

/**
 * Returns number of tiles of a certain type in a room.
 */
RoomIntel.prototype.countTiles = function (type) {
  if (!this.memory.terrain) return 0;

  return this.memory.terrain[type] || 0;
};

/**
 * Returns which exits of a room are considered safe.
 *
 * This is usually when they are dead ends or link up with other rooms
 * owned by us that are sufficiently defensible.
 */
RoomIntel.prototype.calculateAdjacentRoomSafety = function (options) {
  if (!this.memory.exits) return {
    directions: {
      N: false,
      E: false,
      S: false,
      W: false,
    },
    safeRooms: [],
  };

  let dirMap = {
    1: 'N',
    3: 'E',
    5: 'S',
    7: 'W',
  }

  let newStatus = {
    N: true,
    E: true,
    S: true,
    W: true,
  };

  let openList = {};
  let closedList = {};
  let joinedDirs = {};
  let otherSafeRooms = options && options.safe || [];
  // Add initial directions to open list.
  for (let moveDir in this.memory.exits) {
    let dir = dirMap[moveDir];
    let roomName = this.memory.exits[moveDir];

    if (Game.rooms[roomName] && Game.rooms[roomName].controller && Game.rooms[roomName].controller.my) {
      // This is one of our own rooms, and as such is safe.
      if ((Game.rooms[roomName].controller.level >= Math.min(5, this.getRcl() - 1)) && !Game.rooms[roomName].isEvacuating()) {
        continue;
      }
    }
    if (otherSafeRooms.indexOf(roomName) > -1) continue;

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

    let roomExits = hivemind.roomIntel(minRange.room).getExits();
    if (_.size(roomExits) == 0) {
      // Room has no intel, declare it as unsafe.
      newStatus[minRange.origin] = false;
      continue;
    }

    // Add new adjacent rooms to openList if available.
    for (let moveDir in roomExits) {
      let roomName = roomExits[moveDir];

      if (minRange.range >= 3) {
        // Room has open exits more than 3 rooms away.
        // Mark direction as unsafe.
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
        if (Game.rooms[roomName].controller.level >= 5 && !Game.rooms[roomName].isEvacuating() || roomName == this.roomName) {
          continue;
        }
      }
      if (otherSafeRooms.indexOf(roomName) > -1) continue;

      // Room has not been checked yet.
      openList[roomName] = {
        range: minRange.range + 1,
        origin: minRange.origin,
        room: roomName,
      };
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
  let safeRooms = [];
  for (let roomName in closedList) {
    let roomDir = closedList[roomName].origin;
    if (newStatus[roomDir]) {
      safeRooms.push(roomName);
    }
  }

  return {
    directions: newStatus,
    safeRooms: safeRooms,
  };
};

module.exports = RoomIntel;
