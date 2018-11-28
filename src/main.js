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

    try {
      hivemind.runProcess('rooms', RoomsProcess);
    }
    catch (e) {
      console.log('Error when running room process:', e);
      console.log(e.stack);
    }
  },

};
