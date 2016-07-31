/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('role.builder');
 * mod.thing == 'a thing'; // true
 */

// @todo Support energy sources other than containers.

var utilities = require('utilities');

var roleTransporter = {

    getEnergy: function (creep) {
        // Look for energy in Containers, primarily.
        if (!creep.memory.sourceTarget) {
            var targets = creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => {
                    return (structure.structureType == STRUCTURE_CONTAINER) && (structure.store[RESOURCE_ENERGY] >= creep.carryCapacity - creep.carry[RESOURCE_ENERGY]);
                }
            });
            if (targets.length <= 0) {
                return false;
            }
            
            // Prefer containers used as harvester dropoff.
            var dropOffs = _.filter(targets, (target) => {
                if (!target.room.memory.sources) {
                    return false;
                }
                for (var id in target.room.memory.sources) {
                    if (target.room.memory.sources[id].targetContainer == target.id) {
                        return true;
                    }
                }
                return false;
            });

            if (dropOffs && dropOffs.length > 0) {
                creep.memory.sourceTarget = utilities.getClosest(creep, dropOffs);
            }
            else {
                creep.memory.sourceTarget = utilities.getClosest(creep, targets);
            }
        }
        var best = creep.memory.sourceTarget;
        if (!best) {
            return false;
        }
        var target = Game.getObjectById(best);
        if (!target || target.store[RESOURCE_ENERGY] <= 0) {
            creep.memory.sourceTarget = null;
        }
        else if (target.transfer(creep, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
            creep.moveTo(target);
        }
        return true;
    },
    
    deliverEnergy: function (creep) {
        var targets = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return (structure.structureType == STRUCTURE_EXTENSION ||
                        structure.structureType == STRUCTURE_SPAWN) && structure.energy < structure.energyCapacity;
            }
        });
        if (targets.length <= 0) {
            var targets = creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => {
                    if (structure.structureType == STRUCTURE_CONTAINER && structure.store.energy < structure.storeCapacity) {
                        // Do not deliver to containers used as harvester drop off points.
                        if (!structure.room.memory.sources) {
                            return true;
                        }
                        for (var id in structure.room.memory.sources) {
                            if (structure.room.memory.sources[id].targetContainer == structure.id) {
                                return false;
                            }
                        }
                        return true;
                    }
                    return false;
                }
            });
            if (targets.length <= 0) {
                var targets = creep.room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return (structure.structureType == STRUCTURE_TOWER) && structure.energy < structure.energyCapacity;
                    }
                });
                if (targets.length <= 0) {
                    return false;
                }
            }
        }

        if (!creep.memory.deliverTarget) {
            creep.memory.deliverTarget = utilities.getClosest(creep, targets);
        }
        var best = creep.memory.deliverTarget;
        if (!best) {
            return false;
        }
        var target = Game.getObjectById(best);
        if (!target) {
            creep.memory.deliverTarget = null;
        }

        var result = creep.transfer(target, RESOURCE_ENERGY);
        if (result == ERR_NOT_IN_RANGE) {
            creep.moveTo(target);
        }
        if (target.energy >= target.energyCapacity) {
            creep.memory.deliverTarget = null;
        }
        if (target.store && target.store.energy >= target.storeCapacity) {
            creep.memory.deliverTarget = null;
        }
        return true;
    },

    /** @param {Creep} creep **/
    run: function (creep) {
        if (creep.carry[RESOURCE_ENERGY] >= creep.carryCapacity && !creep.memory.delivering) {
            creep.memory.delivering = true;
            creep.memory.sourceTarget = null;
        }
        else if (creep.carry[RESOURCE_ENERGY] <= 0 && creep.memory.delivering) {
            creep.memory.delivering = false;
            creep.memory.deliverTarget = null;
        }
        
        if (!creep.memory.delivering) {
            return roleTransporter.getEnergy(creep);
        }
        else {
            return roleTransporter.deliverEnergy(creep);
        }
        
        return true;
    },
    
    spawn: function (spawner, force) {
        if ((spawner.room.energyAvailable >= spawner.room.energyCapacityAvailable * 0.9 || (force && spawner.room.energyAvailable >= 250)) && !spawner.spawning) {
            var body = utilities.generateCreepBody({move: 0.5, carry: 0.5}, spawner.room.energyAvailable);
            if (spawner.canCreateCreep(body) == OK) {
                var newName = spawner.createCreep(body, undefined, {role: 'transporter'});
                console.log('Spawning new transporter: ' + newName);
                return true;
            }
        }
        return false;
    }
};

module.exports = roleTransporter;