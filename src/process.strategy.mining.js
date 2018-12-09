'use strict';

var Process = require('process');
var stats = require('stats');

var RemoteMiningProcess = function (params, data) {
  Process.call(this, params, data);

  if (!Memory.strategy) {
    Memory.strategy = {};
  }

  if (!Memory.strategy.remoteHarvesting) {
    // Try starting with 2.
    Memory.strategy.remoteHarvesting = {
      currentCount: 2,
      lastCheck: Game.time,
    };
  }
};
RemoteMiningProcess.prototype = Object.create(Process.prototype);

/**
 * Determines optimal number of remote mining rooms based on CPU and expansion plans.
 */
RemoteMiningProcess.prototype.run = function () {
  let memory = Memory.strategy;

  let max = 0;
  let numRooms = 0;

  let sourceRooms = {};

  // Determine how much remote mining each room can handle.
  for (let roomName in Game.rooms) {
    let room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;

    let numSpawns = _.filter(Game.spawns, (spawn) => spawn.pos.roomName == roomName).length;
    if (numSpawns == 0) continue;

    numRooms++;
    max += 2 * numSpawns;

    sourceRooms[roomName] = {
      current: 0,
      max: 2 * numSpawns,
    };
  }

  // Create ordered list of best harvest rooms.
  let harvestRooms = [];
  for (let roomName in memory.roomList) {
    let info = memory.roomList[roomName];
    if (!info.harvestPriority || info.harvestPriority <= 0.1) continue;

    info.harvestActive = false;
    harvestRooms.push(info);
  }
  let sortedRooms = _.sortBy(harvestRooms, (o) => -o.harvestPriority);

  // Decide which are active.
  let total = 0;
  for (let i = 0; i < sortedRooms.length; i++) {
    let info = sortedRooms[i];
    if (!sourceRooms[info.origin]) continue;
    if (sourceRooms[info.origin].current >= sourceRooms[info.origin].max) continue;

    sourceRooms[info.origin].current++;
    info.harvestActive = true;

    total++;
    if (total >= memory.remoteHarvesting.currentCount) break;
  }

  // Adjust remote harvesting number according to cpu.
  if (Game.time - memory.remoteHarvesting.lastCheck >= 1000) {
    memory.remoteHarvesting.lastCheck = Game.time;

    if (stats.getStat('bucket', 10000)) {
      if (stats.getStat('bucket', 10000) >= 9500 && stats.getStat('bucket', 1000) >= 9500 && stats.getStat('cpu_total', 1000) <= 0.9 * Game.cpu.limit) {
        if (memory.remoteHarvesting.currentCount < max) {
          memory.remoteHarvesting.currentCount++;
        }
      }
      else if (stats.getStat('bucket', 1000) <= 8000) {
        if (memory.remoteHarvesting.currentCount > 0) {
          memory.remoteHarvesting.currentCount--;
        }
      }
    }
  }

  // @todo Reduce remote harvesting if we want to expand.

};

module.exports = RemoteMiningProcess;
