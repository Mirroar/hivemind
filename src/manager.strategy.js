var utilities = require('utilities');
var stats = require('stats');
var Squad = require('manager.squad');

var strategyManager = {

  runLogic: function () {
    if (!Memory.strategy) {
      Memory.strategy = {};
    }
    let memory = Memory.strategy;

    strategyManager.manageHarvestRooms();

    strategyManager.managePower();
  },

  /**
   * Determines optimal number of remote harvest rooms based on CPU and expansion plans.
   */
  manageHarvestRooms: function () {
    let memory = Memory.strategy;

    let max = 0;
    let numRooms = 0;

    let sourceRooms = {};

    // Determine how much remote mining each room can handle.
    for (let roomName in Game.rooms) {
      let room = Game.rooms[roomName];
      if (!room.controller || !room.controller.my) continue;

      let numSpawns = _.filter(Game.spawns, (spawn) => spawn.pos.roomName == roomName).length;
      if (numSpawns == 0) continue;

      numRooms++;
      max += 2 * numSpawns;

      sourceRooms[roomName] = {
        current: 0,
        max: 2 * numSpawns,
      };
    }

    if (!memory.remoteHarvesting) {
      // Try starting with 2 per active room.
      memory.remoteHarvesting = {
        currentCount: 2 * numRooms,
        lastCheck: Game.time,
      };
    }

    // Create ordered list of best harvest rooms.
    let harvestRooms = [];
    for (let roomName in memory.roomList) {
      let info = memory.roomList[roomName];
      if (!info.harvestPriority || info.harvestPriority <= 0.1) continue;

      info.harvestActive = false;
      harvestRooms.push(info);
    }
    let sortedRooms = _.sortBy(harvestRooms, (o) => -o.harvestPriority);

    // Decide which are active.
    let total = 0;
    for (let i = 0; i < sortedRooms.length; i++) {
      let info = sortedRooms[i];
      if (!sourceRooms[info.origin]) continue;
      if (sourceRooms[info.origin].current >= sourceRooms[info.origin].max) continue;

      sourceRooms[info.origin].current++;
      info.harvestActive = true;

      total++;
      if (total >= memory.remoteHarvesting.currentCount) break;
    }

    // Adjust remote harvesting number according to cpu.
    if (Game.time - memory.remoteHarvesting.lastCheck >= 1000) {
      memory.remoteHarvesting.lastCheck = Game.time;

      if (stats.getStat('bucket', 10000)) {
        if (stats.getStat('bucket', 10000) >= 9500 && stats.getStat('bucket', 1000) >= 9500 && stats.getStat('cpu_total', 1000) <= 0.9 * Game.cpu.limit) {
          if (memory.remoteHarvesting.currentCount < max) {
            memory.remoteHarvesting.currentCount++;
          }
        }
        else if (stats.getStat('bucket', 1000) <= 8000) {
          if (memory.remoteHarvesting.currentCount > 0) {
            memory.remoteHarvesting.currentCount--;
          }
        }
      }
    }

    // @todo Reduce remote harvesting if we want to expand.

  },

  /**
   * Analizes the power banks detected by intel, to decide which and how to attack.
   */
  managePower: function () {
    let memory = Memory.strategy;

    // @todo Add throttle like with remote harvesting.
    if (!memory.power) {
      memory.power = {};
    }

    if (Memory.disablePowerHarvesting) {
      return;
    }

    for (let roomName in memory.power.rooms || []) {
      // @todo Skip room if we already decided to harvest it.
      let info = memory.power.rooms[roomName];
      // Calculate DPS we'd need to do to harvest this power.
      let timeRemaining = info.decays - Game.time;

      if (info.isActive) {
        // No need to modify this information.
        if (timeRemaining <= 0) {
          delete memory.power.rooms[roomName];
        }
        continue;
      }

      // Substract time we need to spawn first set of attackers.
      timeRemaining -= CREEP_SPAWN_TIME * MAX_CREEP_SIZE;

      // Substract extra time until spawns are ready to generate our creeps.
      timeRemaining -= CREEP_SPAWN_TIME * MAX_CREEP_SIZE * 2 / 3;

      if (timeRemaining <= 0) {
        delete memory.power.rooms[roomName];
        continue;
      }

      let dps = info.hits / timeRemaining;

      /*let attackParts = dps / ATTACK_POWER;
      let healParts = (dps / 2) / HEAL_POWER;
      let moveParts = attackParts + healParts;

      let numCreeps = Math.ceil((attackParts + healParts + moveParts) / MAX_CREEP_SIZE);//*/

      // @todo Maybe adjust strategy to use dedicated attackers and healers if space is limited.

      let partsPerDPS = 2 / ATTACK_POWER;
      let numCreeps = Math.ceil(dps * partsPerDPS / MAX_CREEP_SIZE);

      if (numCreeps > Math.min(5, info.freeTiles)) {
        delete memory.power.rooms[roomName];
        continue;
      }

      hivemind.log('strategy').debug('Gathering ' + info.amount + ' power in ' + roomName + ' would need ' + dps + ' DPS, or ' + numCreeps + ' attack creeps.');

      // Determine which rooms need to spawn creeps.
      let potentialSpawns = [];
      for (let myRoomName in Game.rooms) {
        let room = Game.rooms[myRoomName];
        if (!room.controller || !room.controller.my) continue;
        if (room.isFullOnPower()) continue;
        if (CONTROLLER_STRUCTURES[STRUCTURE_POWER_SPAWN][room.controller.level] < 1) continue;
        if (Game.map.getRoomLinearDistance(roomName, myRoomName) > 5) continue;

        let roomRoute = Game.map.findRoute(myRoomName, roomName);
        if (roomRoute == ERR_NO_PATH || roomRoute.length > 10) continue;

        hivemind.log('strategy').debug('Could spawn creeps in', myRoomName, 'with distance', roomRoute.length);

        potentialSpawns.push({
          room: myRoomName,
          distance: roomRoute.length,
        });
      }

      potentialSpawns = _.sortBy(potentialSpawns, 'distance');

      // Substract travel time until all attackers could be there.
      let maxAttackers = 0;
      let travelTime = 0;
      let failed = true;
      let neededRooms = {};
      let finalDps = 0;
      for (let i in potentialSpawns) {
        let spawnInfo = potentialSpawns[i];

        maxAttackers += 2;
        // Estimate travel time at 50 ticks per room.
        travelTime = spawnInfo.distance * 50;

        let neededDps = info.hits / (timeRemaining - travelTime);
        // @todo Needed Dps multiplier is this high because currently creeps can only attack every 2 ticks.
        let numCreeps = Math.ceil(neededDps * 1.2 * partsPerDPS / MAX_CREEP_SIZE);

        if (numCreeps > Math.min(6, info.freeTiles)) {
          // Would need too many creeps at this distance.
          break;
        }

        neededRooms[spawnInfo.room] = spawnInfo;

        if (maxAttackers >= numCreeps) {
          // Alright, we can spawn enough creeps!
          finalDps = neededDps;
          failed = false;
          break;
        }
      }

      if (failed) {
        // delete memory.power.rooms[roomName];
        continue;
      }

      info.spawnRooms = neededRooms;
      info.maxAttackers = maxAttackers;
      info.isActive = true;
      info.neededDps = finalDps;
      info.dps = maxAttackers * MAX_CREEP_SIZE / partsPerDPS;

      // @todo Record neededRooms and maxAttackers.
      // @todo Calculate number of transporters needed in the end.

      // @todo Start spawning.
      Game.notify('Gathering ' + (info.amount || 'N/A') + ' power from room ' + roomName + '.');
      hivemind.log('strategy').info('Gathering ' + (info.amount || 'N/A') + ' power from room ' + roomName + '.');
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

module.exports = strategyManager;
