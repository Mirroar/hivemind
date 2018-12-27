'use strict';

var utilities = require('utilities');

RoomIntel = function (roomName) {
  this.roomName = roomName;

  if (!Memory.rooms[roomName]) {
    Memory.rooms[roomName] = {};
  }
  if (!Memory.rooms[roomName].intel) {
    Memory.rooms[roomName].intel = {};
  }

  this.memory = Memory.rooms[roomName].intel;
};

RoomIntel.prototype.getAge = function () {
  return Game.time - (this.memory.lastScan || 0);
};

RoomIntel.prototype.isClaimable = function () {
  if (this.memory.hasController) return true;
};

RoomIntel.prototype.isClaimed = function () {
  if (this.isOwned()) return true;
  if (this.memory.reservation && this.memory.reservation.username && this.memory.reservation.username != utilities.getUsername()) return true;

  return false;
};

RoomIntel.prototype.isOwned = function () {
  if (this.memory.owner != utilities.getUsername()) return true;

  return false;
};

RoomIntel.prototype.getRcl = function () {
  return this.memory.rcl || 0;
};

RoomIntel.prototype.getSourcePositions = function () {
  return this.memory.sources || [];
};

RoomIntel.prototype.getMineralType = function () {
  return this.memory.mineralType;
};

RoomIntel.prototype.getExits = function () {
  return this.memory.exits || {};
};

RoomIntel.prototype.getControllerPosition = function () {
  if (!this.memory.structures || !this.memory.structures[STRUCTURE_CONTROLLER]) return;

  let controller = intel.structures[STRUCTURE_CONTROLLER][0];
  return new RoomPosition(controller.x, controller.y, this.roomName);
};

module.exports = RoomIntel;
