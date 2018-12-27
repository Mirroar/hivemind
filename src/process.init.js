'use strict';

var Process = require('process');
var RoomPlanner = require('roomplanner');

var InitProcess = function (params, data) {
  Process.call(this, params, data);
};
InitProcess.prototype = Object.create(Process.prototype);

InitProcess.prototype.run = function () {
  for (let roomName in Game.rooms) {
    let room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;

    room.roomPlanner = new RoomPlanner(room.name);
  }
};

module.exports = InitProcess;
