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
  let memory = Memory.strategy;

  var roomList = this.generateScoutTargets();
  memory.roomList = roomList;

  // Add data to scout list for creating priorities.
  // @todo Add harvestPriority for rooms with harvest flags.
  for (let roomName in roomList) {
    let info = roomList[roomName];

    info.scoutPriority = 0;
    info.expansionScore = 0;
    info.harvestPriority = 0;
    info.roomName = roomName;

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
  }
};

/**
 * Determines how worthwile a room is for expanding.
 */
ScoutProcess.prototype.calculateExpansionScore = function (roomName) {
  let intel = Memory.rooms[roomName].intel;

  // @todo Factor in amount of mineral sources we have to prefer rooms with rarer minerals.
  let score = intel.sources.length;
  if (intel.mineral) {
    score++;
  }

  // @todo Having rooms with many sources nearby is good.
  // @todo Having fewer exit sides is good.
  // @todo Having dead ends / safe rooms nearby is similarly good.
  // @todo Having fewer exit tiles is good.
  // @todo Being close to other player's rooms / reserved rooms is bad.
  return score;
};

/**
 * Generates a list of rooms originating from owned rooms.
 */
ScoutProcess.prototype.generateScoutTargets = function () {
  let roomList = {};

  let openList = {};
  let closedList = {};

  let observers = {};

  // Starting point for scouting operations are owned rooms.
  for (let roomName in Game.rooms) {
    let room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my || !room.memory.intel) continue;

    openList[roomName] = {
      range: 0,
      origin: roomName,
    };

    if (room.observer) {
      observers[roomName] = room.observer;
    }
  }

  // Flood fill from own rooms and add rooms we need intel of.
  while (_.size(openList) > 0) {
    let minDist = null;
    let nextRoom = null;
    for (let rName in openList) {
      let info = openList[rName];
      if (minDist === null || info.range < minDist) {
        minDist = info.range;
        nextRoom = rName;
      }
    }

    if (!nextRoom) {
      break;
    }

    let info = openList[nextRoom];

    // Add unhandled adjacent rooms to open list.
    if (Memory.rooms[nextRoom] && Memory.rooms[nextRoom].intel && Memory.rooms[nextRoom].intel.exits) {
      for (let i in Memory.rooms[nextRoom].intel.exits) {
        let exit = Memory.rooms[nextRoom].intel.exits[i];
        if (openList[exit] || closedList[exit]) continue;

        openList[exit] = {
          range: info.range + 1,
          origin: info.origin,
        };
      }
    }

    delete openList[nextRoom];
    closedList[nextRoom] = true;

    // Add current room as a candidate for scouting.
    if (!roomList[nextRoom] || roomList[nextRoom].range > info.range) {
      let observer = null;
      for (let roomName in observers) {
        let roomDist = Game.map.getRoomLinearDistance(roomName, nextRoom);
        if (roomDist <= OBSERVER_RANGE) {
          if (!observer || roomDist < Game.map.getRoomLinearDistance(observer.pos.roomName, nextRoom)) {
            observer = observers[roomName];
          }
        }
      }

      roomList[nextRoom] = {
        range: info.range,
        origin: info.origin,
        observer: observer && observer.id,
      };
    }
  }

  return roomList;
};

module.exports = ScoutProcess;
