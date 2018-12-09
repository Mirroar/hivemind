var utilities = require('utilities');
var stats = require('stats');
var Squad = require('manager.squad');

var strategyManager = {

  runLogic: function () {
    if (!Memory.strategy) {
      Memory.strategy = {};
    }
    let memory = Memory.strategy;

    strategyManager.managePower();
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
