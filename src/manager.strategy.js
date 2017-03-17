var utilities = require('utilities');
var stats = require('stats');
var Squad = require('manager.squad');

var strategyManager = {

  runLogic: function () {
    if (!Memory.strategy) {
      Memory.strategy = {};
    }
    let memory = Memory.strategy;

    var roomList = strategyManager.generateScoutTargets();
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
          // Decide how worthwhile settling here is.
          // @todo Factor in amount of mineral sources we have to prefer rooms with rarer minerals.
          let expansionScore = 0;
          let intel = Memory.rooms[roomName].intel;

          if (!intel.hasController) continue;
          if (intel.owner) continue;
          if (Memory.rooms[info.origin].intel.rcl < 5) continue;

          expansionScore += intel.sources.length;
          if (intel.mineral) {
            expansionScore++;
          }

          // @todo Having rooms with many sources nearby is good.
          // @todo Having fewer exit sides is good.
          // @todo Having dead ends / safe rooms nearby is similarly good.
          // @todo Having fewer exit tiles is good.
          // @todo Being close to other player's rooms / reserved rooms is bad.

          info.expansionScore = expansionScore;
        }
      }
    }

    strategyManager.manageExpanding();
  },

  generateScoutTargets: function () {
    let roomList = {};

    let openList = {};
    let closedList = {};

    // Starting point for scouting operations are owned rooms.
    for (let roomName in Game.rooms) {
      let room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my || !room.memory.intel) continue;

      openList[roomName] = {
        range: 0,
        origin: roomName,
      };
    }

    // @todo Flood fill from own rooms and add rooms we need intel of.
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
        roomList[nextRoom] = {
          range: info.range,
          origin: info.origin,
        };
      }
    }

    return roomList;
  },

  manageExpanding: function () {
    let memory = Memory.strategy;

    if (!memory.expand) {
      memory.expand = {};
    }

    let canExpand = false;
    let ownedRooms = 0;
    for (let roomName in Game.rooms) {
      let room = Game.rooms[roomName];
      if (room.controller && room.controller.my) ownedRooms++;
    }
    if (ownedRooms < Game.gcl.level) {
      // Check if we have some cpu power to spare.
      if (stats.getStat('cpu_total', 10000) && stats.getStat('cpu_total', 10000) < Game.cpu.limit * 0.8 && stats.getStat('cpu_total', 1000) < Game.cpu.limit * 0.8) {
        canExpand = true;
      }
    }

    if (!memory.expand.currentTarget && canExpand) {
      // Choose a room to expand to.
      // @todo Handle cases where expansion to a target is not reasonable, like it being taken by somebody else, path not being safe, etc.
      let bestTarget = null;
      for (let i in memory.roomList) {
        let info = memory.roomList[i];
        if (!info.expansionScore || info.expansionScore <= 0) continue;

        if (!bestTarget || bestTarget.expansionScore < info.expansionScore) {
          bestTarget = info;
        }
      }

      if (bestTarget) {
        memory.expand.currentTarget = bestTarget;
      }
    }

    if (memory.expand.currentTarget) {
      let info = memory.expand.currentTarget;
      if (!memory.expand.started) {
        // Spawn expanstion squad at origin.
        let key = 'SpawnSquad:expand';
        let spawnPos = new RoomPosition(25, 25, info.origin);
        if (Game.flags[key]) {
          Game.flags[key].setPosition(spawnPos);
        }
        else {
          spawnPos.createFlag(key);
        }

        // Sent to target room.
        key = 'AttackSquad:expand';
        let destinationPos = new RoomPosition(25, 25, info.roomName);
        if (Game.flags[key]) {
          Game.flags[key].setPosition(destinationPos);
        }
        else {
          destinationPos.createFlag(key);
        }

        // @todo Place flags to guide squad through safe rooms and make pathfinding easier.
        let squad = new Squad('expand');
        squad.clearUnits();
        squad.setUnitCount('singleClaim', 1);
        squad.setUnitCount('builder', 2);
        memory.expand.started = true;
      }
      else {
        // Remove claimer from composition once room has been claimed.
        if (Game.rooms[info.roomName]) {
          let room = Game.rooms[info.roomName];
          Game.flags['AttackSquad:expand'].setPosition(room.controller.pos);

          if (room.controller.my) {
            let squad = new Squad('expand');
            squad.setUnitCount('singleClaim', 0);

            if (room.controller.level > 3 && room.storage) {
              memory.expand = {};
              squad.clearUnits();

              if (Game.flags['AttackSquad:expand']) {
                Game.flags['AttackSquad:expand'].remove();
              }
              if (Game.flags['SpawnSquad:expand']) {
                Game.flags['SpawnSquad:expand'].remove();
              }

              return;
            }
          }
        }
      }
    }
  },

};

Room.prototype.needsScout = function () {
  if (!Memory.strategy) {
    return false;
  }
  let memory = Memory.strategy;

  for (let roomName in memory.roomList) {
    let info = memory.roomList[roomName];

    if (info.origin == this.name && info.scoutPriority > 0) {
      return true;
    }
  }

  return false;
};

Room.prototype.getRemoteHarvestTargets = function () {
  // @todo Cache this if we use it during spawning.

  if (!Memory.strategy) return [];
  let memory = Memory.strategy;

  let numSpawns = _.filter(Game.spawns, (spawn) => spawn.pos.roomName == this.name).length;
  let maxHarvesting = 1 + numSpawns;
  let targets = {};

  for (let numTargets = 0; numTargets < maxHarvesting; numTargets++) {
    let bestTarget = null;
    for (let i in memory.roomList) {
      let info = memory.roomList[i];

      if (targets[info.roomName]) continue;
      if (info.origin !== this.name) continue;

      if (info.harvestPriority && info.harvestPriority > 0) {
        if (!bestTarget || bestTarget.harvestPriority < info.harvestPriority) {
          bestTarget = info;
        }
      }
    }

    if (bestTarget) {
      targets[bestTarget.roomName] = bestTarget;
    }
  }

  return targets;
};

module.exports = strategyManager;
