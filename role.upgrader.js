/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('role.upgrader');
 * mod.thing == 'a thing'; // true
 */
 
var roleTransporter = require('role.transporter');
var utilities = require('utilities');

var roleUpgrader = {

    /** @param {Creep} creep **/
    run: function(creep) {

        if (creep.memory.upgrading && creep.carry.energy == 0) {
            creep.memory.upgrading = false;
            creep.memory.tempRole = null;
        }
        if (!creep.memory.upgrading && creep.carry.energy == creep.carryCapacity) {
            creep.memory.upgrading = true;
            creep.memory.tempRole = null;
        }

        if (creep.memory.upgrading) {
            if (creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
                creep.moveTo(creep.room.controller);
            }
        }
        else {
            if (roleTransporter.getEnergy(creep)) {
                return true;
            }
            
            // If all else fails, harvest own resources.
            var sources = creep.room.find(FIND_SOURCES);
            if (sources.length <= 0) {
                return false;
            }
            
            if (!creep.memory.resourceTarget) {
                //creep.memory.resourceTarget = utilities.getClosest(creep, sources);
                creep.memory.resourceTarget = sources[Math.floor(Math.random() * sources.length)].id;
                creep.memory.deliverTarget = null;
            }
            var best = creep.memory.resourceTarget;
            if (!best) {
                return false;
            }
            var source = Game.getObjectById(best);
            if (!source) {
                creep.memory.resourceTarget = null;
            }
            
            if (creep.harvest(source) == ERR_NOT_IN_RANGE) {
                var result = creep.moveTo(source);
                if (result == ERR_NO_PATH) {
                    if (!creep.memory.moveFailCount) {
                        creep.memory.moveFailCount = 0;
                    }
                    creep.memory.moveFailCount++;
                    
                    if (creep.memory.moveFailCount > 10) {
                        creep.memory.moveFailCount = null;
                        creep.memory.resourceTarget = null;
                    }
                } else {
                    creep.memory.moveFailCount = null;
                }
            }
            return true;
        }
    },
    
    spawn: function (spawner) {
        if (spawner.room.energyAvailable >= spawner.room.energyCapacityAvailable * 0.9 && !spawner.spawning) {
            var body = utilities.generateCreepBody({move: 0.1, work: 0.3, carry: 0.6}, spawner.room.energyAvailable);
            if (spawner.canCreateCreep(body) == OK) {
                var newName = spawner.createCreep(body, undefined, {role: 'upgrader'});
                console.log('Spawning new upgrader: ' + newName);
                return true;
            }
        }
        return false;
    }
};

module.exports = roleUpgrader;