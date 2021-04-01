'use strict';

/* global */

module.exports = class TradeRoute {
  constructor(name) {
    if (!Memory.tradeRoutes) Memory.tradeRoutes = {};
    if (!Memory.tradeRoutes[name]) Memory.tradeRoutes[name] = {};

    this.memory = Memory.tradeRoutes[name];
  }

  setOrigin(roomName) {
    this.memory.origin = roomName;
  }

  getOrigin() {
    return this.memory.origin;
  }

  setTarget(roomName) {
    this.memory.target = roomName;
  }

  getTarget() {
    return this.memory.target;
  }

  setActive(active) {
    this.memory.active = active;
  }

  isActive() {
    return this.memory.active;
  }

  setPath(path) {
    this.memory.roomPath = path;
  }

  getPath() {
    return this.memory.roomPath;
  }

  getReversePath() {
    return this.memory.roomPath.slice(0, -1).reverse().concat([this.getOrigin()]);
  }

  setResourceType(resourceType) {
    this.memory.resourceType = resourceType;
  }

  getResourceType() {
    return this.memory.resourceType;
  }

  setTravelLength(length) {
    this.memory.travelLength = length;
    this.memory.travelLengthCalculated = Game.time;
  }

  getTravelLength() {
    return this.memory.travelLength;
  }

  hasTravelLength() {
    return this.memory.travelLength && (Game.time - this.memory.travelLengthCalculated < 10000);
  }
};
