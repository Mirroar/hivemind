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
