'use strict';

// Make sure game object prototypes are enhanced.
require('creep.prototype');

var Hivemind = require('hivemind');
global.hivemind = new Hivemind();

var RoomsProcess = require('process.rooms');

var oldMain = require('main.old');

module.exports = {

  /**
   * Runs main game loop.
   */
  loop: function () {
    try {
      hivemind.runProcess('rooms', RoomsProcess);
    }
    catch (e) {
      console.log('Error when running room process:', e);
      console.log(e.stack);
    }

    // @todo Remove old "main" code eventually.
    oldMain.loop();
  },

};
