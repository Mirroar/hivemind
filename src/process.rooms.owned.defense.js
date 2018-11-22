'use strict';

var Process = require('process');

var RoomDefenseProcess = function (params, data) {
  Process.call(this, params, data);
  this.room = params.room;
};
RoomDefenseProcess.prototype = Object.create(Process.prototype);

/**
 * Moves energy between links.
 *
 * Determines which links serve as energy input or output, and transfers
 * dynamically between those and neutral links.
 */
RoomDefenseProcess.prototype.run = function () {
  // Handle towers.
  var towers = this.room.find(FIND_MY_STRUCTURES, {
    filter: (structure) => (structure.structureType == STRUCTURE_TOWER) && structure.energy > 0,
  });
  for (var i in towers) {
    // @todo Try / catch.
    towers[i].runLogic();
  }
};

module.exports = RoomDefenseProcess;
