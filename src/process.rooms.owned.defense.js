'use strict';

var Process = require('process');

var RoomDefenseProcess = function (params, data) {
  Process.call(this, params, data);
  this.room = params.room;
};
RoomDefenseProcess.prototype = Object.create(Process.prototype);

/**
 * Moves energy between links.
 *
 * Determines which links serve as energy input or output, and transfers
 * dynamically between those and neutral links.
 */
RoomDefenseProcess.prototype.run = function () {
  // Handle towers.
  var towers = this.room.find(FIND_MY_STRUCTURES, {
    filter: (structure) => (structure.structureType == STRUCTURE_TOWER) && structure.energy > 0,
  });

  if (towers.length == 0) return;

  let hostileCreeps = this.room.find(FIND_HOSTILE_CREEPS);
  for (var tower of towers) {
    // Emergency repairs.
    /*var closestDamagedStructure = tower.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: (structure) => {
            if (structure.structureType == STRUCTURE_WALL) {
                return ((structure.pos.getRangeTo(tower) <= 5 && structure.hits < 10000) || structure.hits < 1000) && tower.energy > tower.energyCapacity * 0.7;
            }
            if (structure.structureType == STRUCTURE_RAMPART) {
                return ((structure.pos.getRangeTo(tower) <= 5 && structure.hits < 10000) || structure.hits < 1000) && tower.energy > tower.energyCapacity * 0.7 || structure.hits < 500;
            }
            return (structure.hits < structure.hitsMax - TOWER_POWER_REPAIR) && (structure.hits < structure.hitsMax * 0.2);
        }
    });
    if (closestDamagedStructure) {
        tower.repair(closestDamagedStructure);
    }//*/

    // Attack enemies.
    if (hostileCreeps.length > 0) {
      var target = this.room.getTowerTarget(tower);
      if (target) {
        tower.attack(target);
        return true;
      }
    }

    // Heal friendlies.
    var damaged = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
      filter: (creep) => creep.hits < creep.hitsMax
    });
    if (damaged) {
      tower.heal(damaged);
    }
  }
};

module.exports = RoomDefenseProcess;
