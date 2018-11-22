'use strict';

var Process = require('process');
var RoomDefenseProcess = require('process.rooms.owned.defense');
var ManageLinksProcess = require('process.rooms.owned.links');

var OwnedRoomProcess = function (params, data) {
  Process.call(this, params, data);
  this.room = params.room;
};
OwnedRoomProcess.prototype = Object.create(Process.prototype);

OwnedRoomProcess.prototype.run = function () {
  // @todo Only run processes based on current room level.
  this.room.generateLinkNetwork();
  hivemind.runProcess(this.room.name + '_defense', RoomDefenseProcess, {
    room: this.room,
  });
  hivemind.runProcess(this.room.name + '_links', ManageLinksProcess, {
    interval: 10,
    room: this.room,
  });
};

module.exports = OwnedRoomProcess;
