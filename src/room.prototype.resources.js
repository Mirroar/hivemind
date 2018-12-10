'use strict';

var utilities = require('utilities');

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

Room.prototype.getStoredEnergy = function () {
  // @todo Add caching, make sure it's fresh every tick.
  var total = this.getCurrentResourceAmount(RESOURCE_ENERGY);

  var storageLocation = this.getStorageLocation();
  storageLocation = new RoomPosition(storageLocation.x, storageLocation.y, this.name);
  var resources = _.filter(storageLocation.lookFor(LOOK_RESOURCES), (resource) => resource.resourceType == RESOURCE_ENERGY);
  if (resources.length > 0) {
    total += resources[0].amount;
  }

  return total;
};

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
  return this.getCurrentResourceAmount(RESOURCE_POWER) > this.getStorageLimit() / 6;
};

Room.prototype.isFullOnMinerals = function () {
  return this.getCurrentMineralAmount() > this.getStorageLimit() / 3;
};

Room.prototype.isFullOn = function (resourceType) {
  if (resourceType == RESOURCE_ENERGY) return this.isFullOnEnergy();
  if (resourceType == RESOURCE_POWER) return this.isFullOnPower();
  return this.isFullOnMinerals();
};

/**
 * Calculates a central room position with some free space around it for placing a storage later.
 * If a storage already exists, its position is returned.
 */
Room.prototype.getStorageLocation = function () {
  var room = this;

  if (!this.controller) {
    return;
  }

  if (this.roomPlanner && this.roomPlanner.memory.locations && this.roomPlanner.memory.locations.center) {
    for (let pos in this.roomPlanner.memory.locations.center) {
      return utilities.decodePosition(pos);
    }
  }

  if (!room.memory.storage) {
    if (room.storage) {
      room.memory.storage = {
        x: room.storage.pos.x,
        y: room.storage.pos.y
      };
    }
    else {
      var sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: (site) => site.structureType == STRUCTURE_STORAGE
      });
      if (sites && sites.length > 0) {
        room.memory.storage = {
          x: sites[0].pos.x,
          y: sites[0].pos.y
        };
      }
      else {
        // Determine decent storage spot by averaging source and spawner locations.
        var count = 1;
        var x = room.controller.pos.x;
        var y = room.controller.pos.y;

        for (var i in room.sources) {
          x += room.sources[i].pos.x;
          y += room.sources[i].pos.y;
          count++;
        }
        var spawns = room.find(FIND_STRUCTURES, {
          filter: (structure) => structure.structureType == STRUCTURE_SPAWN
        });
        for (var i in spawns) {
          x += spawns[i].pos.x;
          y += spawns[i].pos.y;
          count++;
        }

        x = Math.round(x / count);
        y = Math.round(y / count);

        // Now that we have a base position, try to find the
        // closest spot that is surrounded by empty tiles.
        var dist = 0;
        var found = false;
        while (!found && dist < 10) {
          for (var tx = x - dist; tx <= x + dist; tx++) {
            for (var ty = y - dist; ty <= y + dist; ty++) {
              if (found) {
                continue;
              }

              if (tx == x - dist || tx == x + dist || ty == y - dist || ty == y + dist) {
                // Tile is only valid if it and all surrounding tiles are empty.
                var contents = room.lookAtArea(ty - 1, tx - 1, ty + 1, tx + 1, true);
                var clean = true;
                for (var i in contents) {
                  var tile = contents[i];
                  if (tile.type == 'terrain' && tile.terrain != 'plain' && tile.terrain != 'swamp') {
                    clean = false;
                    break;
                  }
                  if (tile.type == 'structure' || tile.type == 'constructionSite') {
                    clean = false;
                    break;
                  }
                }

                if (clean) {
                  found = true;
                  room.memory.storage = {
                    x: tx,
                    y: ty
                  };
                }
              }
            }
          }

          // @todo Limit dist and find "worse" free spot otherwise.
          dist++;
        }
      }
    }
  }

  return room.memory.storage;
};

Room.prototype.prepareForTrading = function (resourceType, amount) {
  if (!amount) amount = 10000;
  this.memory.fillTerminal = resourceType;
  this.memory.fillTerminalAmount = Math.min(amount, 50000);
};

Room.prototype.stopTradePreparation = function () {
  delete this.memory.fillTerminal;
  delete this.memory.fillTerminalAmount;
};

/**
 * Gets a list of remote mining targets designated for this room.
 */
Room.prototype.getRemoteHarvestTargets = function () {
  // @todo Cache this if we use it during spawning.

  if (!Memory.strategy) return [];
  let memory = Memory.strategy;

  let targets = {};

  for (let i in memory.roomList) {
    let info = memory.roomList[i];

    if (info.origin !== this.name) continue;
    if (!info.harvestActive) continue;

    targets[info.roomName] = info;
  }

  return targets;
};
