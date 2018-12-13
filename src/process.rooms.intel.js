'use strict';

var Process = require('process');
var intelManager = require('manager.intel');

var RoomIntelProcess = function (params, data) {
  Process.call(this, params, data);
  this.room = params.room;
};
RoomIntelProcess.prototype = Object.create(Process.prototype);

RoomIntelProcess.prototype.run = function () {
  this.findHostiles();
};

RoomIntelProcess.prototype.findHostiles = function () {
  this.room.gatherIntel();

  // From time to time, prune very old room data.
  // @todo remove when intelManager gets removed.
  if (Game.time % 3738 === 2100) {
      intelManager.pruneRoomMemory();
  }

  let hostiles = this.room.find(FIND_HOSTILE_CREEPS);
  let parts = {};
  let lastSeen = this.room.memory.enemies && this.room.memory.enemies.lastSeen || 0;
  let safe = true;

  if (hostiles.length > 0) {
    this.room.assertMilitarySituation();
  }

  if (hostiles.length > 0) {
    // Count body parts for strength estimation.
    for (let j in hostiles) {
      if (hostiles[j].isDangerous()) {
        safe = false;
        lastSeen = Game.time;
      }
      for (let k in hostiles[j].body) {
        let type = hostiles[j].body[k].type;
        if (!parts[type]) {
          parts[type] = 0;
        }
        parts[type]++;
      }
    }
  }

  this.room.memory.enemies = {
    parts: parts,
    lastSeen: lastSeen,
    safe: safe,
  };
}

module.exports = RoomIntelProcess;
