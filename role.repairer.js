/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('role.builder');
 * mod.thing == 'a thing'; // true
 */

// @todo Try to have different targets.
// @todo Use energy from storage.
// @todo Walls and ramparts should be repaired to the same amount, not percentage.

var roleTransporter = require('role.transporter');
var utilities = require('utilities');

var roleBuilder = {

    /** @param {Creep} creep **/
    run: function (creep) {

        if (creep.memory.building && creep.carry.energy == 0) {
            creep.memory.building = false;
            creep.memory.buildTarget = null;
            creep.memory.tempRole = null;
        }
        else if (!creep.memory.building && creep.carry.energy == creep.carryCapacity) {
            creep.memory.building = true;
            creep.memory.resourceTarget = null;
            creep.memory.tempRole = null;
        }

        if (creep.memory.building) {
            // @todo Get repairer creep list from main function where it exists already.
            var repairers = _.filter(Game.creeps, (creep) => creep.memory.role == 'repairer');
            var targets = creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => {
                    if (structure.hits < structure.hitsMax) {
                        // Make sure this structure is not already being repaired by another vehicle unless it is very damaged.
                        if (structure.hits < structure.hitsMax * 0.3) {
                            return true;
                        }
                        for (var i in repairers) {
                            if (repairers[i].memory.buildTarget && repairers[i].memory.buildTarget == structure.id) {
                                return false;
                            }
                        }
                        return true;
                    }
                    return false;
                }
            });
            if (targets.length <= 0) {
                return false;
            }

            if (!creep.memory.buildTarget) {
                creep.memory.resourceTarget = null;
                creep.memory.buildTarget = null;
                
                var minPercent = 1.0;
                var minPercentWall = 1.0;
                var minWall = null;
                for (var i = 0; i < targets.length; i++) {
                    var target = targets[i];
                    if (1.0 * target.hits / target.hitsMax < minPercent && target.structureType != STRUCTURE_WALL && target.structureType != STRUCTURE_RAMPART) {
                        minPercent = 1.0 * target.hits / target.hitsMax;
                        creep.memory.buildTarget = target.id;
                    }
                    else if (1.0 * target.hits / target.hitsMax < minPercentWall && (target.structureType == STRUCTURE_WALL || target.structureType == STRUCTURE_RAMPART)) {
                        minPercentWall = 1.0 * target.hits / target.hitsMax;
                        minWall = target.id;
                    }
                }
                
                if (minPercent > 0.9 && minPercent > minPercentWall) {
                    creep.memory.buildTarget = minWall;
                }
            }
            var best = creep.memory.buildTarget;
            if (!best) {
                return false;
            }
            var target = Game.getObjectById(best);
            if (!target || !target.hits || target.hits >= target.hitsMax) {
                creep.memory.buildTarget = null;
            }
            
            if (creep.repair(target) == ERR_NOT_IN_RANGE) {
                creep.moveTo(target);
            }
            return true;
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
            var body = utilities.generateCreepBody({move: 0.5, work: 0.2, carry: 0.3}, spawner.room.energyAvailable);
            if (spawner.canCreateCreep(body) == OK) {
                var newName = spawner.createCreep(body, undefined, {role: 'repairer'});
                console.log('Spawning new repairer: ' + newName);
                return true;
            }
        }
        return false;
    }
};

module.exports = roleBuilder;