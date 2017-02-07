var utilities = require('utilities');
var intelManager = require('manager.intel');
var strategyManager = require('manager.strategy');

/**
 * Makes this creep move between rooms to gather intel.
 */
Creep.prototype.performScout = function () {
  // @todo Do stuff.

  let target = new RoomPosition(25, 25, this.pos.roomName);
  if (this.pos.getRangeTo(target) > 3) {
    this.moveToRange(target, 3);
  }
};

Creep.prototype.chooseScoutTarget = function () {
  if (!Memory.strategy) {
    return false;
  }
  let memory = Memory.strategy;

  let best = null;
  let bestRoom = null;
  for (let roomName in memory.roomList) {
    let info = memory.roomList[roomName];

    if (info.origin == this.memory.origin && info.scoutPriority > 0) {
      if (!best || best.scoutPriority < info.scoutPriority) {
        // @todo Check distance / path to room.
        best = info;
        bestRoom = roomName;
      }
    }
  }

  if (best) {
    this.memory.scoutTarget = bestRoom;
  }
};

/**
 * Makes a creep behave like a scout.
 */
Creep.prototype.runScoutLogic = function () {
  if (!this.memory.scoutTarget) {
    if (!this.chooseScoutTarget()) {
      return false;
    }
  }

  this.performScout();
};
