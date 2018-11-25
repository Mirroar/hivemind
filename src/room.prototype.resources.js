'use strict';

Room.prototype.getStoredEnergy = function () {
  // @todo Add caching, make sure it's fresh every tick.
  var total = 0;
  if (this.storage) {
    total += this.storage.store[RESOURCE_ENERGY];
  }
  if (this.terminal) {
    total += this.terminal.store[RESOURCE_ENERGY];
  }

  var storageLocation = this.getStorageLocation();
  // @todo Use RoomPosition.findAt().
  var resources = this.find(FIND_DROPPED_RESOURCES, {
    filter: (resource) => resource.resourceType == RESOURCE_ENERGY && resource.pos.x == storageLocation.x && resource.pos.y == storageLocation.y
  });
  if (resources && resources.length > 0) {
    total += resources[0].amount;
  }

  return total;
};

Room.prototype.getStorageLimit = function () {
  let total = 0;
  if (this.storage) {
    total = total + this.storage.storeCapacity;
  }
  else {
    // Assume 10000 storage for dropping stuff on the ground.
    total = total + 10000;
  }
  if (this.terminal) {
    total = total + this.terminal.storeCapacity;
  }

  return total;
}

Room.prototype.getStorageCapacity = function () {
  // Determines amount of free space in storage.
  let limit = this.getStorageLimit();
  if (this.storage) {
    limit = limit - _.sum(this.storage.store);
  }
  if (this.terminal) {
    limit = limit - _.sum(this.terminal.store);
  }

  return limit;
}

Room.prototype.getCurrentResourceAmount = function (resourceType) {
  let total = 0;
  if (this.storage && this.storage.store[resourceType]) {
    total = total + this.storage.store[resourceType];
  }
  if (this.terminal && this.terminal.store[resourceType]) {
    total = total + this.terminal.store[resourceType];
  }

  return total;
}

Room.prototype.getCurrentMineralAmount = function () {
  // @todo This could use caching.
  let total = 0;

  for (let i in RESOURCES_ALL) {
    let resourceType = RESOURCES_ALL[i];
    if (resourceType == RESOURCE_ENERGY || resourceType == RESOURCE_POWER) continue;
    total = total + this.getCurrentResourceAmount(resourceType);
  }

  return total;
};

Room.prototype.isFullOnEnergy = function () {
  return this.getCurrentResourceAmount(RESOURCE_ENERGY) > this.getStorageLimit() / 2;
};

Room.prototype.isFullOnPower = function () {
  return this.getCurrentResourceAmount(RESOURCE_ENERGY) > this.getStorageLimit() / 6;
};

Room.prototype.isFullOnMinerals = function () {
  return this.getCurrentMineralAmount() > this.getStorageLimit() / 3;
};

Room.prototype.isFullOn = function (resourceType) {
  if (resourceType == RESOURCE_ENERGY) return this.isFullOnEnergy();
  if (resourceType == RESOURCE_POWER) return this.isFullOnPower();
  return this.isFullOnMinerals();
};
