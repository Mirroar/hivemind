var utilities = require('utilities');
var stats = require('stats');
var Squad = require('manager.squad');

var strategyManager = {

  runLogic: function () {
  },
};

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

Room.prototype.getRemoteHarvestTargets = function () {
  // @todo Cache this if we use it during spawning.

  if (!Memory.strategy) return [];
  let memory = Memory.strategy;

  let targets = {};

  for (let i in memory.roomList) {
    let info = memory.roomList[i];

    if (info.origin !== this.name) continue;
    if (!info.harvestActive) continue;

    targets[info.roomName] = info;
  }

  return targets;
};

module.exports = strategyManager;
