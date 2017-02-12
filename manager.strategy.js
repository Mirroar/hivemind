var strategyManager = {

  runLogic: function () {
    if (!Memory.strategy) {
      Memory.strategy = {};
    }
    let memory = Memory.strategy;

    var roomList = strategyManager.generateScoutTargets();
    memory.roomList = roomList;

    let canExpand = false;
    let ownedRooms = 0;
    for (let roomName in Game.rooms) {
      let room = Game.rooms[roomName];
      if (room.controller && room.controller.my) ownedRooms++;
    }
    if (ownedRooms < Game.gcl.level) {
      canExpand = true;
    }

    // Add data to scout list for creating priorities.
    for (let roomName in roomList) {
      let info = roomList[roomName];

      info.scoutPriority = 0;
      info.expansionScore = 0;

      if (info.range > 0 && info.range <= 2) {
        // This is a potential room for remote mining.
        let scoutPriority = 0;
        if (!Memory.rooms[roomName] || !Memory.rooms[roomName].intel) {
          scoutPriority = 3;
        }
        else {
          let intel = Memory.rooms[roomName].intel;
          if (Game.time - intel.lastScan > 10000) {
            scoutPriority = 2;
          }
        }

        if (scoutPriority > info.scoutPriority) {
          info.scoutPriority = scoutPriority;
        }
      }
      else if (info.range > 2 && info.range <= 5) {
        // This room might be interesting for expansions.
        if (!Memory.rooms[roomName] || !Memory.rooms[roomName].intel || Memory.rooms[roomName].intel.lastScan > 10000) {
          info.scoutPriority = 1;
        }
        else {
          // Decide how worthwile settling here is.
          // @todo Factor in amount of mineral sources we have to prefer rooms with rarer minerals.
          let expansionScore = 0;
          let intel = Memory.rooms[roomName].intel;

          if (!intel.hasController) continue;
          if (intel.owner) continue;

          expansionScore += intel.sources.length;
          if (intel.mineral) {
            expansionScore++;
          }

          info.expansionScore = expansionScore;
        }
      }
    }

    if (canExpand) {
      strategyManager.manageExpanding();
    }
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
        if (!minDist || info.range < minDist) {
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

module.exports = strategyManager;
