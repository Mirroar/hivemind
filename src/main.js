'use strict';

// Make sure game object prototypes are enhanced.
require('creep.prototype');
require('room.prototype');

console.log('new global reset');

// Create kernel object.
var Hivemind = require('hivemind');
global.hivemind = new Hivemind();

// Load top-level processes.
var InitProcess = require('process.init');
var RoomsProcess = require('process.rooms');
var ExpandProcess = require('process.strategy.expand');
var RemoteMiningProcess = require('process.strategy.mining');
var PowerMiningProcess = require('process.strategy.power');
var ScoutProcess = require('process.strategy.scout');
var TradeProcess = require('process.empire.trade');
var ResourcesProcess = require('process.empire.resources');
var ReactionsProcess = require('process.empire.reactions');

// @todo Refactor old main code away.
var oldMain = require('main.old');

// Allow profiling of code.
var profiler = require('profiler');
var stats = require('stats');
var utilities = require('utilities');

module.exports = {

  /**
   * Runs main game loop.
   */
  loop: function () {
    if (profiler) {
      profiler.wrap(this.runTick);
    }
    else {
      this.runTick();
    }
  },

  runTick: function () {
    if (Memory.isAccountThrottled) {
      Game.cpu.limit = 20;
    }

    hivemind.onTickStart();

    hivemind.runProcess('init', InitProcess, {
      priority: PROCESS_PRIORITY_ALWAYS,
    });

    // @todo Remove old "main" code eventually.
    oldMain.loop();

    hivemind.runProcess('rooms', RoomsProcess, {
      priority: PROCESS_PRIORITY_ALWAYS,
    });
    hivemind.runProcess('strategy.scout', ScoutProcess, {
      interval: 50,
      priority: PROCESS_PRIORITY_LOW,
    });
    // @todo This process could be split up - decisions about when and where to expand can be executed at low priority. But management of actual expansions is high priority.
    hivemind.runProcess('strategy.expand', ExpandProcess, {
      interval: 50,
      priority: PROCESS_PRIORITY_HIGH,
    });
    hivemind.runProcess('strategy.remote_mining', RemoteMiningProcess, {
      interval: 100,
    });
    hivemind.runProcess('strategy.power_mining', PowerMiningProcess, {
      interval: 100,
    });

    hivemind.runProcess('empire.trade', TradeProcess, {
      interval: 50,
      priority: PROCESS_PRIORITY_LOW,
    });
    hivemind.runProcess('empire.resources', ResourcesProcess, {
      interval: 50,
    });
    hivemind.runProcess('empire.reactions', ReactionsProcess, {
      interval: 1500,
      priority: PROCESS_PRIORITY_LOW,
    });

    // hivemind.runCreeps();

    this.cleanup();
    this.recordStats();
  },

  recordStats: function () {
    if (Game.time % 10 == 0 && Game.cpu.bucket < 9800) {
      hivemind.log('main').info('Bucket:', Game.cpu.bucket);
    }

    let time = Game.cpu.getUsed();

    if (time > Game.cpu.limit * 1.2) {
      hivemind.log('cpu').info('High CPU:', time + '/' + Game.cpu.limit);
    }

    stats.recordStat('cpu_total', time);
    stats.recordStat('bucket', Game.cpu.bucket);
    stats.recordStat('creeps', _.size(Game.creeps));
  },

  cleanup: function () {
    // Periodically clean creep memory.
    if (Game.time % 16 == 7) {
      for (var name in Memory.creeps) {
        if (!Game.creeps[name]) {
          delete Memory.creeps[name];
        }
      }
    }

    // Periodically clean flag memory.
    if (Game.time % 1000 == 725) {
      for (let flagName in Memory.flags) {
        if (!Game.flags[flagName]) {
          delete Memory.flags[flagName];
        }
      }
    }

    // Check if memory is getting too bloated.
    if (Game.time % 836 == 0) {
      if (RawMemory.get().length > 1800000) {
        Memory.hivemind.maxScoutDistance = (Memory.hivemind.maxScoutDistance || 7) - 1;
        for (let roomName in Memory.strategy.roomList) {
          if (Memory.strategy.roomList[roomName].range > Memory.hivemind.maxScoutDistance) {
            delete Memory.rooms[roomName];
            delete Memory.strategy.roomList[roomName];
          }
        }
      }
    }

    // Preiodically clean old room memory.
    if (Game.time % 3738 === 2100) {
      let count = 0;
      for (let roomName in Memory.rooms) {
        if (hivemind.roomIntel(roomName).getAge() > 100000) {
          delete Memory.rooms[roomName];
          count++;
          continue;
        }

        if (Memory.rooms[roomName].roomPlanner && (!Game.rooms[roomName] || !Game.rooms[roomName].controller || !Game.rooms[roomName].controller.my)) {
          delete Memory.rooms[roomName].roomPlanner;
          count++;
        }
      }

      if (count > 0) {
        hivemind.log('main').debug('Pruned old memory for', count, 'rooms.');
      }
    }
  },

};
