var strategyManager = {

  runLogic: function () {

    if (!Memory.strategy) {
      Memory.strategy = {};
    }
    let memory = Memory.strategy;

    var roomList = strategyManager.generateScoutTargets();
    memory.roomList = roomList;

    // @todo Create scouts when no observer in range of a listed room, and send scouts to those rooms.

  },

  generateScoutTargets: function () {
    let roomList = {};

    // Starting point for scouting operations are owned rooms.
    for (let roomName in Game.rooms) {
      let room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my || !room.memory.intel) continue;

      let openList = {};
      openList[roomName] = {range: 0};
      let closedList = {};

      // @todo Flood fill from center of room and add rooms we need intel of.
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
        delete openList[nextRoom];
        closedList[nextRoom] = true;

        // Add unhandled adjacent rooms to open list.
        if (Memory.rooms[nextRoom] && Memory.rooms[nextRoom].intel && Memory.rooms[nextRoom].intel.exits) {
          for (let i in Memory.rooms[nextRoom].intel.exits) {
            let exit = Memory.rooms[nextRoom].intel.exits[i];
            if (openList[exit] || closedList[exit]) continue;

            openList[exit] = {range: minDist + 1};
          }
        }

        // Add current room as a candidate for scouting.
        if (!roomList[nextRoom] || roomList[nextRoom].range > minDist) {
          roomList[nextRoom] = {
            range: minDist,
            origin: roomName,
          };
        }
      }
    }

    return roomList;
  },

};

module.exports = strategyManager;
