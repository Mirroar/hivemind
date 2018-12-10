'use strict';

if (!Room.prototype.__enhancementsLoaded) {
  require('room.prototype.creeps');
  require('room.prototype.pathfinding');
  require('room.prototype.resources');
  require('room.prototype.structures');

  Room.prototype.needsScout = function () {
    if (!Memory.strategy) {
      return false;
    }
    let memory = Memory.strategy;

    for (let roomName in memory.roomList) {
      let info = memory.roomList[roomName];

      if (info.origin == this.name && info.scoutPriority >= 1) {
        return true;
      }
    }

    return false;
  };

  Room.prototype.__enhancementsLoaded = true;
}
