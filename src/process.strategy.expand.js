'use strict';

var Process = require('process');
var Squad = require('manager.squad');
var stats = require('stats');

var ExpandProcess = function (params, data) {
  Process.call(this, params, data);

  if (!Memory.strategy) {
    Memory.strategy = {};
  }
  if (!Memory.strategy.expand) {
    Memory.strategy.expand = {};
  }
};
ExpandProcess.prototype = Object.create(Process.prototype);

/**
 * Sends a squad for expanding to a new room if GCL and CPU allow.
 */
ExpandProcess.prototype.run = function () {
  let memory = Memory.strategy;

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
    for (let i in memory.roomList || []) {
      let info = memory.roomList[i];
      if (!info.expansionScore || info.expansionScore <= 0) continue;

      // Don't try to expand to a room that can't be reached safely.
      if (!Game.rooms[info.origin] || !Game.rooms[info.origin].calculateRoomPath(info.roomName)) continue;

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
    let squad = new Squad('expand');
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
      squad.clearUnits();
      squad.setUnitCount('brawler', 1);
      squad.setUnitCount('singleClaim', 1);
      squad.setUnitCount('builder', 1);
      squad.setPath(null);
      memory.expand.started = Game.time;
    }
    else {
      // Remove claimer from composition once room has been claimed.
      if (Game.rooms[info.roomName]) {
        // @todo If path to controller is blocked, send dismantlers to dismantle
        // blocking buildings, or construct a tunnel to the controller.

        let room = Game.rooms[info.roomName];
        Game.flags['AttackSquad:expand'].setPosition(room.controller.pos);

        if (room.controller.my) {
          if (!memory.expand.claimed) {
            memory.expand.claimed = Game.time;
            squad.setUnitCount('builder', 2);
            squad.setUnitCount('singleClaim', 0);
          }

          if (room.controller.level > 3 && room.storage) {
            this.stopExpansion(squad);
            return;
          }
        }
      }

      // @todo Abort if claiming takes too long and we don't have anything
      // to dismantle in the way of the controller.

      // If a lot of time has passed, let the room fend for itself anyways,
      // either it will be lost or fix itself.
      if (Game.time - memory.expand.claimed > 50 * CREEP_LIFE_TIME) {
        this.stopExpansion(squad);
      }
    }
  }
};

/**
 * Sends a squad for expanding to a new room if GCL and CPU allow.
 */
ExpandProcess.prototype.stopExpansion = function (squad) {
  Memory.strategy.expand = {};
  squad.clearUnits();

  if (Game.flags['AttackSquad:expand']) {
    Game.flags['AttackSquad:expand'].remove();
  }
  if (Game.flags['SpawnSquad:expand']) {
    Game.flags['SpawnSquad:expand'].remove();
  }
};

module.exports = ExpandProcess;
