'use strict';

var Process = require('process');
var OwnedRoomProcess = require('process.rooms.owned');
var RoomIntelProcess = require('process.rooms.intel');

var RoomsProcess = function (params, data) {
  Process.call(this, params, data);
};
RoomsProcess.prototype = Object.create(Process.prototype);

RoomsProcess.prototype.run = function () {
  for (let roomName in Game.rooms) {
    let room = Game.rooms[roomName];
    hivemind.runProcess('rooms_intel', RoomIntelProcess, {
      room: room,
    })

    // Manage owned rooms.
    // @todo Keep a list of managed rooms in memory so we can notice when
    // a room gets lost or a new one claimed.
    if (room.controller && room.controller.my) {
      // @todo
      hivemind.runProcess('owned_rooms', OwnedRoomProcess, {
        room: room,
      });
    }
  }
};

module.exports = RoomsProcess;
