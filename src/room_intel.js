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

/**
 * Returns number of ticks since intel on this room was last gathered.
 */
RoomIntel.prototype.getAge = function () {
  return Game.time - (this.memory.lastScan || 0);
};

/**
 * Checks whether this room could be claimed by a player.
 */
RoomIntel.prototype.isClaimable = function () {
  if (this.memory.hasController) return true;
};

/**
 * Checks whether this room is claimed by another player.
 *
 * This checks ownership and reservations.
 */
RoomIntel.prototype.isClaimed = function () {
  if (this.isOwned()) return true;
  if (this.memory.reservation && this.memory.reservation.username && this.memory.reservation.username != utilities.getUsername()) return true;

  return false;
};

/**
 * Checks if the room is owned by another player.
 */
RoomIntel.prototype.isOwned = function () {
  if (this.memory.owner != utilities.getUsername()) return true;

  return false;
};

/**
 * Returns this room's last known rcl level.
 */
RoomIntel.prototype.getRcl = function () {
  return this.memory.rcl || 0;
};

/**
 * Returns position of energy sources in the room.
 */
RoomIntel.prototype.getSourcePositions = function () {
  return this.memory.sources || [];
};

/**
 * Returns type of mineral source in the room, if available.
 */
RoomIntel.prototype.getMineralType = function () {
  return this.memory.mineralType;
};

/**
 * Returns a list of rooms connected to this one, keyed by direction.
 */
RoomIntel.prototype.getExits = function () {
  return this.memory.exits || {};
};

/**
 * Returns position of the Controller structure in this room.
 */
RoomIntel.prototype.getControllerPosition = function () {
  if (!this.memory.structures || !this.memory.structures[STRUCTURE_CONTROLLER]) return;

  let controller = intel.structures[STRUCTURE_CONTROLLER][0];
  return new RoomPosition(controller.x, controller.y, this.roomName);
};

/**
 * Returns number of tiles of a certain type in a room.
 */
RoomIntel.prototype.countTiles = function (type) {
  if (!this.memory.terrain) return 0;

  return this.memory.terrain[type] || 0;
};

module.exports = RoomIntel;
