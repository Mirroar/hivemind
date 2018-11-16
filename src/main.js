'use strict';

// Make sure game object prototypes are enhanced.
require('creep.prototype');

var oldMain = require('main.old');

module.exports = {

  /**
   * Runs main game loop.
   */
  loop: function () {
    // @todo Remove old "main" code eventually.
    oldMain.loop();
  },

};
