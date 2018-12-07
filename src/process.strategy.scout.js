'use strict';

var Process = require('process');
var utilities = require('utilities');

var ScoutProcess = function (params, data) {
  Process.call(this, params, data);

  if (!Memory.strategy) {
    Memory.strategy = {};
  }
};
ScoutProcess.prototype = Object.create(Process.prototype);

ScoutProcess.prototype.run = function () {
  Memory.strategy.roomList = this.generateScoutTargets();

  // Add data to scout list for creating priorities.
  for (let roomName in Memory.strategy.roomList) {
    this.calculateRoomPriorities(roomName);
  }
};

ScoutProcess.prototype.calculateRoomPriorities = function (roomName) {
  let roomList = Memory.strategy.roomList;

  let info = roomList[roomName];

  info.roomName = roomName;
  info.scoutPriority = 0;
  info.expansionScore = 0;
  info.harvestPriority = 0;

  if (info.range > 0 && info.range <= 2) {
    // This is a potential room for remote mining.
    let scoutPriority = 0;
    if (!Memory.rooms[roomName] || !Memory.rooms[roomName].intel) {
      scoutPriority = 3;
    }
    else {
      let intel = Memory.rooms[roomName].intel;
      if (Game.time - intel.lastScan > 5000) {
        scoutPriority = 2;
      }
      else if (intel.hasController && !intel.owner && (!intel.reservation || !intel.reservation.username || intel.reservation.username == utilities.getUsername())) {
        let income = -2000; // Flat cost for room reservation
        let pathLength = 0;
        for (let i in intel.sources) {
          income += 3000;
          pathLength += info.range * 50; // Flag path length if it has not been calculated yet.
          if (typeof(intel.sources[i]) == 'object') {
            let sourcePos = new RoomPosition(intel.sources[i].x, intel.sources[i].y, roomName);
            utilities.precalculatePaths(Game.rooms[info.origin], sourcePos);

            if (Memory.rooms[info.origin].remoteHarvesting) {
              let harvestMemory = Memory.rooms[info.origin].remoteHarvesting[utilities.encodePosition(sourcePos)];
              if (harvestMemory && harvestMemory.cachedPath) {
                pathLength -= info.range * 50;
                pathLength += harvestMemory.cachedPath.path.length;
              }
            }
          }
        }

        if (pathLength > 0) {
          info.harvestPriority = income / pathLength;
        }
      }
    }

    if (scoutPriority > info.scoutPriority) {
      info.scoutPriority = scoutPriority;
    }
  }
  else if (info.range > 2 && info.range <= 5) {
    // This room might be interesting for expansions.
    if (!Memory.rooms[roomName] || !Memory.rooms[roomName].intel || Game.time - Memory.rooms[roomName].intel.lastScan > 5000) {
      info.scoutPriority = 1;
    }
    else {
      // Check if we could reasonably expand to this room.
      let intel = Memory.rooms[roomName].intel;
      if (!intel.hasController) continue;
      if (intel.owner) continue;
      if (Memory.rooms[info.origin].intel.rcl < 5) continue;

      info.expansionScore = this.calculateExpansionScore(roomName);
    }
  }

  if (info.observer && info.range <= 6 && (/^[EW][0-9]*0[NS][0-9]+$/.test(roomName) || /^[EW][0-9]+[NS][0-9]*0$/.test(roomName)) && (!Memory.rooms[roomName] || !Memory.rooms[roomName].intel || (Game.time - Memory.rooms[roomName].intel.lastScan > 1000))) {
    // Corridor rooms get scouted more often to look for power banks.
    info.scoutPriority = 2;
  }

  if (info.scoutPriority > 0 && info.observer) {
    // Only observe if last Scan was longer ago than intel manager delay,
    // so we don't get stuck scanning the same room for some reason.
    if (!Memory.rooms[roomName] || !Memory.rooms[roomName].intel || Game.time - Memory.rooms[roomName].intel.lastScan > 500) {
      // No need to manually scout rooms in range of an observer.
      info.scoutPriority = 0.5;

      // Let observer scout one room per run at maximum.
      // @todo Move this to structure management so we can scan one open room per tick.
      let observer = Game.getObjectById(info.observer);
      if (observer && !observer.hasScouted) {
        observer.observeRoom(roomName);
        observer.hasScouted = true;
      }
    }
  }
};

/**
 * Determines how worthwile a room is for expanding.
 */
ScoutProcess.prototype.calculateExpansionScore = function (roomName) {
  let intel = Memory.rooms[roomName].intel;

  // More sources is better.
  let score = intel.sources.length;

  // Having a mineral source is good.
  if (intel.mineral) {
    score++;
  }

  // Having fewer exit sides is good.
  let exits = intel.exits || [];
  score += 1 - intel.exits.length * 0.25;
  for (let i in exits) {
    let adjacentRoom = exits[i];
    let adjacentIntel = Memory.rooms[adjacentRoom] && Memory.rooms[adjacentRoom].intel || {};

    if (adjacentIntel.owner) {
      // Try not to expand too close to other players.
      // @todo Also check for room reservation.
      score -= 0.5;
    }
    else {
      // Adjacent rooms having more sources is good.
      score += adjacentIntel.sources && adjacentIntel.sources.length * 0.1 || 0;
    }
  }

  // @todo Prefer rooms with minerals we have little sources of.
  // @todo Having dead ends / safe rooms nearby is similarly good.
  // @todo Having fewer exit tiles is good.
  return score;
};

/**
 * Generates a list of rooms originating from owned rooms.
 */
ScoutProcess.prototype.generateScoutTargets = function () {
  let roomList = {};

  let openList = this.getScoutOrigins();
  let closedList = {};

  this.findObservers();

  // Flood fill from own rooms and add rooms we need intel of.
  while (_.size(openList) > 0) {
    let nextRoom = this.getNextRoomCandidate(openList);

    if (!nextRoom) break;

    this.addAdjacentRooms(nextRoom, openList, closedList);
    let info = openList[nextRoom];
    delete openList[nextRoom];
    closedList[nextRoom] = true;

    // Add current room as a candidate for scouting.
    if (!roomList[nextRoom] || roomList[nextRoom].range > info.range) {
      let observer = this.getClosestObserver(nextRoom);

      roomList[nextRoom] = {
        range: info.range,
        origin: info.origin,
        observer: observer && observer.id,
      };
    }
  }

  return roomList;
};

/**
 * Generates a list of rooms that can serve as a starting point for scouting.
 */
ScoutProcess.prototype.getScoutOrigins = function () {
  let openList = {};

  // Starting point for scouting operations are owned rooms.
  for (let roomName in Game.rooms) {
    let room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my || !room.memory.intel) continue;

    openList[roomName] = {
      range: 0,
      origin: roomName,
    };
  }

  return openList;
};

/**
 * Generates a list of observer structures keyed by room name.
 */
ScoutProcess.prototype.findObservers = function () {
  this.observers = [];
  for (let roomName in Game.rooms) {
    let room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my || !room.observer) continue;

    this.observers[roomName] = room.observer;
  }
};

/**
 * Gets a the room from the list that has the lowest range from an origin point.
 */
ScoutProcess.prototype.getNextRoomCandidate = function (openList) {
  let minDist = null;
  let nextRoom = null;
  for (let rName in openList) {
    let info = openList[rName];
    if (minDist === null || info.range < minDist) {
      minDist = info.range;
      nextRoom = rName;
    }
  }

  return nextRoom;
};

/**
 * Adds unhandled adjacent rooms to open list.
 */
ScoutProcess.prototype.addAdjacentRooms = function (roomName, openList, closedList) {
  let info = openList[roomName];
  if (Memory.rooms[roomName] && Memory.rooms[roomName].intel && Memory.rooms[roomName].intel.exits) {
    for (let i in Memory.rooms[roomName].intel.exits) {
      let exit = Memory.rooms[roomName].intel.exits[i];
      if (openList[exit] || closedList[exit]) continue;

      openList[exit] = {
        range: info.range + 1,
        origin: info.origin,
      };
    }
  }
};

/**
 * Finds the closest observer to a given room.
 */
ScoutProcess.prototype.getClosestObserver = function (roomName) {
  let observer = null;
  for (let observerRoom in this.observers) {
    let roomDist = Game.map.getRoomLinearDistance(observerRoom, roomName);
    if (roomDist <= OBSERVER_RANGE) {
      if (!observer || roomDist < Game.map.getRoomLinearDistance(observer.pos.roomName, roomName)) {
        observer = this.observers[observerRoom];
      }
    }
  }

  return observer;
};

module.exports = ScoutProcess;
