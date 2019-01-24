'use strict';

var utilities = require('utilities');

var RoomIntel = function (roomName) {
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
 * Updates intel for a room.
 */
RoomIntel.prototype.gatherIntel = function () {
  let room = Game.rooms[this.roomName];
  if (!room) return;

  var intel = this.memory;

  // @todo Have process logic handle throttling of this task .
  let lastScanThreshold = 500;
  if (Game.cpu.bucket < 5000) {
    lastScanThreshold = 2500;
  }

  if (intel.lastScan && Game.time - intel.lastScan < lastScanThreshold) return;
  hivemind.log('intel', room.name).debug('Gathering intel after', intel.lastScan && Game.time - intel.lastScan || 'infinite', 'ticks.');
  intel.lastScan = Game.time;

  this.gatherControllerIntel(room);
  this.gatherResourceIntel(room);
  this.gatherTerrainIntel();

  let structures = _.groupBy(room.find(FIND_STRUCTURES), 'structureType');
  this.gatherPowerIntel(structures[STRUCTURE_POWER_BANK]);
  this.gatherStructureIntel(structures, STRUCTURE_KEEPER_LAIR);
  this.gatherStructureIntel(structures, STRUCTURE_CONTROLLER);

  // Remember room exits.
  this.memory.exits = Game.map.describeExits(room.name);

  // At the same time, create a PathFinder CostMatrix to use when pathfinding through this room.
  this.memory.costMatrix = room.generateCostMatrix().serialize();

  // @todo Check for portals.

  // @todo Check enemy structures.

  // @todo Maybe even have a modified military CostMatrix that can consider moving through enemy structures.
};

/**
 * Commits controller status to memory.
 */
RoomIntel.prototype.gatherControllerIntel = function (room) {
  this.memory.owner = null;
  this.memory.rcl = 0;
  this.memory.ticksToDowngrade = 0;
  this.memory.ticksToNeutral = 0;
  this.memory.hasController = (room.controller ? true : false);
  if (room.controller && room.controller.owner) {
    this.memory.owner = room.controller.owner.username;
    this.memory.rcl = room.controller.level;
    this.memory.ticksToDowngrade = room.controller.ticksToDowngrade;
    this.memory.ticksToNeutral = this.memory.ticksToDowngrade;
    for (let i = 1; i < this.memory.rcl; i++) {
      this.memory.ticksToNeutral += CONTROLLER_DOWNGRADE[i];
    }
  }

  this.memory.reservation = room.controller && room.controller.reservation || {
    username: null,
    ticksToEnd: 0,
  };
};

/**
 * Commits room resources to memory.
 */
RoomIntel.prototype.gatherResourceIntel = function (room) {
  // Check sources.
  this.memory.sources = _.map(
    room.find(FIND_SOURCES),
    function (source) {
      return {
        x: source.pos.x,
        y: source.pos.y,
        id: source.id,
      }
    }
  );

  // Check minerals.
  var mineral = _.first(room.find(FIND_MINERALS));
  this.memory.mineral = mineral && mineral.id;
  this.memory.mineralType = mineral && mineral.mineralType;
};

/**
 * Commits basic terrain metrics to memory.
 */
RoomIntel.prototype.gatherTerrainIntel = function () {
  // Check terrain.
  this.memory.terrain = {
    exit: 0,
    wall: 0,
    swamp: 0,
    plain: 0,
  };
  let terrain = new Room.Terrain(this.roomName);
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      let tileType = terrain.get(x, y);
      // Check border tiles.
      if (x == 0 || y == 0 || x == 49 || y == 49) {
        if (tileType != TERRAIN_MASK_WALL) {
          this.memory.terrain.exit++;
        }
        continue;
      }

      // Check non-border tiles.
      switch (tileType) {
        case TERRAIN_MASK_WALL:
          this.memory.terrain.wall++;
          break;

        case TERRAIN_MASK_SWAMP:
          this.memory.terrain.swamp++;
          break;

        default:
          this.memory.terrain.plain++;
      }
    }
  }
};

/**
 * Commits power bank status to memory.
 */
RoomIntel.prototype.gatherPowerIntel = function (powerBanks) {
  delete this.memory.power;

  let powerBank = _.first(powerBanks);
  if (!powerBank) return;

  // For now, send a notification!
  hivemind.log('intel', this.roomName).info('Power bank containing', powerBank.amount, 'power found!');

  // Find out how many access points there are around this power bank.
  let terrain = new Room.Terrain(this.roomName);
  let numFreeTiles = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx == 0 && dy == 0) continue;
      if (terrain.get(powerBank.pos.x + dx, powerBank.pos.y + dy) != TERRAIN_MASK_WALL) {
        numFreeTiles++;
      }
    }
  }

  this.memory.power = {
    amount: powerBank.power,
    hits: powerBank.hits,
    decays: Game.time + (powerBank.ticksToDecay || POWER_BANK_DECAY),
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
    if (!Memory.strategy.power.rooms[this.roomName] || !Memory.strategy.power.rooms[this.roomName].isActive) {
      Memory.strategy.power.rooms[this.roomName] = this.memory.power;
    }
  }
};

/**
 * Commits structure status to memory.
 */
RoomIntel.prototype.gatherStructureIntel = function (structures, structureType) {
  if (!this.memory.structures) this.memory.structures = {};
  this.memory.structures[structureType] = {};
  for (let structure of structures[structureType] || []) {
    this.memory.structures[structureType][structure.id] = {
      x: structure.pos.x,
      y: structure.pos.y,
      hits: structure.hits,
      hitsMax: structure.hitsMax,
    };
  }
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
  if (!this.memory.owner) return false;
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
 * Returns a cost matrix for the given room.
 */
RoomIntel.prototype.getCostMatrix = function () {
  if (this.memory.costMatrix) return PathFinder.CostMatrix.deserialize(this.memory.costMatrix);
  if (Game.rooms[this.roomName]) return Game.rooms[this.roomName].generateCostMatrix();

  return new PathFinder.CostMatrix();
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

  let controller = _.sample(this.memory.structures[STRUCTURE_CONTROLLER]);
  return new RoomPosition(controller.x, controller.y, this.roomName);
};

/**
 * Returns position and id of certain structures.
 */
RoomIntel.prototype.getStructures = function (structureType) {
  if (!this.memory.structures || !this.memory.structures[structureType]) return [];
  return this.memory.structures[structureType];
};

/**
 * Returns number of tiles of a certain type in a room.
 */
RoomIntel.prototype.countTiles = function (type) {
  if (!this.memory.terrain) return 0;

  return this.memory.terrain[type] || 0;
};

/**
 * Returns which exits of a room are considered safe.
 *
 * This is usually when they are dead ends or link up with other rooms
 * owned by us that are sufficiently defensible.
 */
RoomIntel.prototype.calculateAdjacentRoomSafety = function (options) {
  if (!this.memory.exits) return {
    directions: {
      N: false,
      E: false,
      S: false,
      W: false,
    },
    safeRooms: [],
  };

  let dirMap = {
    1: 'N',
    3: 'E',
    5: 'S',
    7: 'W',
  }

  let newStatus = {
    N: true,
    E: true,
    S: true,
    W: true,
  };

  let openList = {};
  let closedList = {};
  let joinedDirs = {};
  let otherSafeRooms = options && options.safe || [];
  // Add initial directions to open list.
  for (let moveDir in this.memory.exits) {
    let dir = dirMap[moveDir];
    let roomName = this.memory.exits[moveDir];

    if (Game.rooms[roomName] && Game.rooms[roomName].controller && Game.rooms[roomName].controller.my) {
      // This is one of our own rooms, and as such is safe.
      if ((Game.rooms[roomName].controller.level >= Math.min(5, this.getRcl() - 1)) && !Game.rooms[roomName].isEvacuating()) {
        continue;
      }
    }
    if (otherSafeRooms.indexOf(roomName) > -1) continue;

    openList[roomName] = {
      range: 1,
      origin: dir,
      room: roomName,
    };
  }

  // Process adjacent rooms until range has been reached.
  while (_.size(openList) > 0) {
    let minRange = null;
    for (let roomName in openList) {
      if (!minRange || minRange.range > openList[roomName].range) {
        minRange = openList[roomName];
      }
    }

    delete openList[minRange.room];
    closedList[minRange.room] = minRange;

    let roomIntel = hivemind.roomIntel(minRange.room);
    if (roomIntel.getAge() > 100000) {
      // Room has no intel, declare it as unsafe.
      newStatus[minRange.origin] = false;
      continue;
    }

    // Add new adjacent rooms to openList if available.
    let roomExits = roomIntel.getExits();
    for (let moveDir in roomExits) {
      let roomName = roomExits[moveDir];

      if (minRange.range >= 3) {
        // Room has open exits more than 3 rooms away.
        // Mark direction as unsafe.
        newStatus[minRange.origin] = false;
        break;
      }

      let found = openList[roomName] || closedList[roomName] || false;
      if (found) {
        if (found.origin != minRange.origin) {
          // Two different exit directions are joined here.
          // Treat them as the same.
          if (!joinedDirs[found.origin]) {
            joinedDirs[found.origin] = {};
          }
          joinedDirs[found.origin][minRange.origin] = true;
        }
        continue;
      }

      if (Game.rooms[roomName] && Game.rooms[roomName].controller && Game.rooms[roomName].controller.my) {
        // This is one of our own rooms, and as such is safe.
        if (Game.rooms[roomName].controller.level >= 5 && !Game.rooms[roomName].isEvacuating() || roomName == this.roomName) {
          continue;
        }
      }
      if (otherSafeRooms.indexOf(roomName) > -1) continue;

      // Room has not been checked yet.
      openList[roomName] = {
        range: minRange.range + 1,
        origin: minRange.origin,
        room: roomName,
      };
    }
  }

  // Unify status of directions which meet up somewhere.
  for (let dir1 in joinedDirs) {
    for (let dir2 in joinedDirs[dir1]) {
      newStatus[dir1] = newStatus[dir1] && newStatus[dir2];
      newStatus[dir2] = newStatus[dir1] && newStatus[dir2];
    }
  }

  // Keep a list of rooms declared as safe in memory.
  let safeRooms = [];
  for (let roomName in closedList) {
    let roomDir = closedList[roomName].origin;
    if (newStatus[roomDir]) {
      safeRooms.push(roomName);
    }
  }

  return {
    directions: newStatus,
    safeRooms: safeRooms,
  };
};

module.exports = RoomIntel;
