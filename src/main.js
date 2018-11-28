'use strict';

// Make sure game object prototypes are enhanced.
require('creep.prototype');
require('room.prototype');

// Create kernel object.
var Hivemind = require('hivemind');
global.hivemind = new Hivemind();

// Load top-level processes.
var RoomsProcess = require('process.rooms');

// @todo Refactor old main code away.
var oldMain = require('main.old');

// Allow profiling of code.
var profiler = require('profiler');
var stats = require('stats');

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
    // @todo Remove old "main" code eventually.
    oldMain.loop();

    hivemind.runProcess('rooms', RoomsProcess);

    this.recordStats();
  },

  recordStats: function () {
    let time = Game.cpu.getUsed();

    if (time > Game.cpu.limit * 1.2) {
      var linePrefix = '                     ';
      hivemind.log('cpu').info('High CPU:', time + '/' + Game.cpu.limit, "\n" + linePrefix + utilities.generateCPUStats());
    }

    stats.recordStat('cpu_total', time);
    stats.recordStat('bucket', Game.cpu.bucket);
    stats.recordStat('creeps', _.size(Game.creeps));
  },

};
