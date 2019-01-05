'use strict';

/**
* Gathers information about a rooms sources and saves it to memory for faster access.
*/
Room.prototype.scan = function () {
  var room = this;

  // Check if the controller has a container nearby.
  var structures = room.find(FIND_STRUCTURES, {
    filter: (structure) => structure.structureType == STRUCTURE_CONTAINER && structure.pos.getRangeTo(room.controller) <= 3
  });
  if (structures && structures.length > 0) {
    room.memory.controllerContainer = structures[0].id;
  }
  else {
    delete room.memory.controllerContainer;
  }

  // Check if the controller has a link nearby.
  var structures = room.find(FIND_STRUCTURES, {
    filter: (structure) => structure.structureType == STRUCTURE_LINK && structure.pos.getRangeTo(room.controller) <= 3
  });
  if (structures && structures.length > 0) {
    room.memory.controllerLink = structures[0].id;
  }
  else {
    delete room.memory.controllerLink;
  }

  // Check if storage has a link nearby.
  if (room.storage) {
    var structures = room.find(FIND_STRUCTURES, {
      filter: (structure) => structure.structureType == STRUCTURE_LINK && structure.pos.getRangeTo(room.storage) <= 3
    });
    if (structures && structures.length > 0) {
      room.memory.storageLink = structures[0].id;
    }
    else {
      delete room.memory.storageLink;
    }
  }

  // Scan room for labs.
  // @todo Find labs not used for reactions, to do creep boosts.
  if (!room.memory.labsLastChecked || room.memory.labsLastChecked < Game.time - 3267) {
    room.memory.labsLastChecked = Game.time;
    room.memory.canPerformReactions = false;

    var labs = room.find(FIND_STRUCTURES, {
      filter: (structure) => structure.structureType == STRUCTURE_LAB && structure.isActive()
    });
    if (labs.length >= 3) {
      // Find best 2 source labs for other labs to perform reactions.
      let best = null;
      for (let i in labs) {
        var lab = labs[i];

        var closeLabs = lab.pos.findInRange(FIND_STRUCTURES, 2, {
          filter: (structure) => structure.structureType == STRUCTURE_LAB && structure.id != lab.id
        });
        if (closeLabs.length < 2) continue;

        for (let j in closeLabs) {
          let lab2 = closeLabs[j];

          let reactors = [];
          for (let k in closeLabs) {
            let reactor = closeLabs[k];
            if (reactor == lab || reactor == lab2) continue;
            if (reactor.pos.getRangeTo(lab2) > 2) continue;

            reactors.push(reactor.id);
          }

          if (reactors.length == 0) continue;
          if (!best || best.reactor.length < reactors.length) {
            best = {
              source1: lab.id,
              source2: lab2.id,
              reactor: reactors,
            };
          }
        }
      }

      if (best) {
        room.memory.canPerformReactions = true;
        room.memory.labs = best;
      }
    }
  }
};

Room.prototype.needsScout = function () {
  if (!Memory.strategy) {
    return false;
  }
  let memory = Memory.strategy;

  for (let roomName in memory.roomList) {
    let info = memory.roomList[roomName];

    if (info.origin == this.name && info.scoutPriority >= 1) {
      return true;
    }
  }

  return false;
};

Room.prototype.gatherIntel = function () {
  var room = this;
  if (!room.memory.intel) {
    room.memory.intel = {};
  }
  var intel = room.memory.intel;

  let lastScanThreshold = 500;
  // @todo Have process logic handle throttling of this task .
  if (Game.cpu.bucket < 5000) {
    lastScanThreshold = 2500;
  }

  if (intel.lastScan && Game.time - intel.lastScan < lastScanThreshold) return;
  hivemind.log('intel', this.name).debug('Gathering intel after', intel.lastScan && Game.time - intel.lastScan || 'infinite', 'ticks.');
  intel.lastScan = Game.time;

  // Check room controller.
  intel.owner = null;
  intel.rcl = 0;
  intel.ticksToDowngrade = 0;
  intel.ticksToNeutral = 0;
  intel.hasController = (room.controller ? true : false);
  if (room.controller && room.controller.owner) {
    intel.owner = room.controller.owner.username;
    intel.rcl = room.controller.level;
    intel.ticksToDowngrade = room.controller.ticksToDowngrade;

    let total = intel.ticksToDowngrade;
    for (let i = 1; i < intel.rcl; i++) {
      total += CONTROLLER_DOWNGRADE[i];
    }
    intel.ticksToNeutral = total;
  }

  intel.reservation = {
    username: null,
    ticksToEnd: 0,
  };
  if (room.controller && room.controller.reservation) {
    intel.reservation = room.controller.reservation;
  }

  // Check sources.
  var sources = this.find(FIND_SOURCES);
  intel.sources = [];
  intel.sourcePos = [];
  for (let i in sources) {
    intel.sources.push({
      x: sources[i].pos.x,
      y: sources[i].pos.y,
      id: sources[i].id,
    });
  }

  // Check minerals.
  delete intel.mineral;
  delete intel.mineralType;
  var minerals = this.find(FIND_MINERALS);
  for (let i in minerals) {
    intel.mineral = minerals[i].id;
    intel.mineralType = minerals[i].mineralType;
  }

  // Check terrain.
  intel.terrain = {
    exit: 0,
    wall: 0,
    swamp: 0,
    plain: 0,
  };
  let terrain = new Room.Terrain(this.name);
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      let tileType = terrain.get(x, y);
      // Check border tiles.
      if (x == 0 || y == 0 || x == 49 || y == 49) {
        if (tileType | TERRAIN_MASK_WALL == 0) {
          intel.terrain.exit++;
        }
        continue;
      }

      // Check non-border tiles.
      if (tileType | TERRAIN_MASK_WALL > 0) {
        intel.terrain.wall++;
      }
      else if (tileType | TERRAIN_MASK_SWAMP > 0) {
        intel.terrain.swamp++;
      }
      else {
        intel.terrain.plain++;
      }
    }
  }

  // Check structures.
  intel.structures = {};
  delete intel.power;
  var structures = room.find(FIND_STRUCTURES);
  for (let i in structures) {
    let structure = structures[i];
    let structureType = structure.structureType;

    // Check for power.
    if (structureType == STRUCTURE_POWER_BANK) {
      // For now, send a notification!
      hivemind.log('intel', this.name).info('Power bank found!');

      // Find out how many access points are around this power bank.
      let numFreeTiles = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx == 0 && dy == 0) continue;
          if (terrain.get(structure.pos.x + dx, structure.pos.y + dy) != TERRAIN_MASK_WALL) {
            numFreeTiles++;
          }
        }
      }

      intel.power = {
        amount: structure.power,
        hits: structure.hits,
        decays: Game.time + (structure.ticksToDecay || POWER_BANK_DECAY),
        freeTiles: numFreeTiles,
      };

      // Also store room in strategy memory for easy access.
      if (Memory.strategy) {
        if (!Memory.strategy.power) {
          Memory.strategy.power = {};
        }
        if (!Memory.strategy.power.rooms) {
          Memory.strategy.power.rooms = {};
        }
        if (!Memory.strategy.power.rooms[this.name] || !Memory.strategy.power.rooms[this.name].isActive) {
          Memory.strategy.power.rooms[this.name] = intel.power;
        }
      }
    }
    else if (structureType == STRUCTURE_KEEPER_LAIR || structureType == STRUCTURE_CONTROLLER) {
      if (!intel.structures[structureType]) {
        intel.structures[structureType] = {};
      }
      intel.structures[structureType][structure.id] = {
        x: structure.pos.x,
        y: structure.pos.y,
        hits: structure.hits,
        hitsMax: structure.hitsMax,
      };
    }
  }

  // Remember room exits.
  intel.exits = Game.map.describeExits(room.name);

  // At the same time, create a PathFinder CostMatrix to use when pathfinding through this room.
  var costs = room.generateCostMatrix(structures);
  intel.costMatrix = costs.serialize();

  // @todo Check for portals.

  // @todo Check enemy structures.

  // @todo Maybe even have a modified military CostMatrix that can consider moving through enemy structures.

  // Perform normal scan process.
  room.scan();
};
