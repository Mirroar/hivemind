/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('role.harvester');
 * mod.thing == 'a thing'; // true
 */

// @todo Assign close-by container to dump resources.
// @todo Assign harvesters to a specific resource spot and balance numbers accordingly.

var gameState = require('game.state');
var utilities = require('utilities');

var roleHarvester = {

    harvest: function (creep) {
        var source;
        if (creep.memory.fixedSource) {
            source = Game.getObjectById(creep.memory.fixedSource);
            // @todo Just in case, handle source not existing anymore.
        }
        else {
            if (!creep.memory.resourceTarget) {
                var sources = creep.room.find(FIND_SOURCES);
                if (sources.length <= 0) {
                    return false;
                }

                //creep.memory.resourceTarget = utilities.getClosest(creep, sources);
                creep.memory.resourceTarget = sources[Math.floor(Math.random() * sources.length)].id;
                creep.memory.deliverTarget = null;
            }
            var best = creep.memory.resourceTarget;
            if (!best) {
                return false;
            }
            source = Game.getObjectById(best);
            if (!source) {
                creep.memory.resourceTarget = null;
            }
        }

        if (creep.harvest(source) == ERR_NOT_IN_RANGE) {
            var result = creep.moveTo(source);
            if (result == ERR_NO_PATH) {
                // If source can't be reached for a while, find a new one.
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
    },

    deliver: function (creep) {
        var target;
        if (creep.memory.fixedTarget && gameState.getNumTransporters(creep.pos.roomName) > 0) {
            //console.log(gameState.getNumTransporters(creep.pos.roomName), 'transporters found...', creep.pos.roomName);
            target = Game.getObjectById(creep.memory.fixedTarget);
        }
        else if (creep.memory.fixedDropoffSpot && gameState.getNumTransporters(creep.pos.roomName) > 0) {
            if (creep.pos.x == creep.memory.fixedDropoffSpot.x && creep.pos.y == creep.memory.fixedDropoffSpot.y) {
                creep.drop(RESOURCE_ENERGY);
            } else {
                creep.moveTo(creep.memory.fixedDropoffSpot.x, creep.memory.fixedDropoffSpot.y);
            }
            return true;
        }
        else {
            // @todo Use transporter drop off logic.
            if (!creep.memory.deliverTarget) {
                var targets = creep.room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return (structure.structureType == STRUCTURE_EXTENSION ||
                                structure.structureType == STRUCTURE_SPAWN ||
                                structure.structureType == STRUCTURE_TOWER) && structure.energy < structure.energyCapacity;
                    }
                });
                if (targets.length <= 0) {
                    // Containers get filled when all other structures are full.
                    targets = creep.room.find(FIND_STRUCTURES, {
                        filter: (structure) => {
                            return (structure.structureType == STRUCTURE_CONTAINER) && structure.storeCapacity && structure.store[RESOURCE_ENERGY] < structure.storeCapacity;
                        }
                    });
                    if (targets.length <= 0) {
                        return false;
                    }
                }

                creep.memory.resourceTarget = null;
                creep.memory.deliverTarget = utilities.getClosest(creep, targets);
            }
            var best = creep.memory.deliverTarget;
            if (!best) {
                return false;
            }
            target = Game.getObjectById(best);
            if (!target) {
                creep.memory.deliverTarget = null;
            }
        }

        if (creep.transfer(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
            creep.moveTo(target);
        }
        if (target.energy >= target.energyCapacity) {
            creep.memory.deliverTarget = null;
        }
        if (target.store && target.store[RESOURCE_ENERGY] >= target.storeCapacity) {
            if (creep.memory.fixedTarget && target.id == creep.memory.fixedTarget) {
                // Container is full, drop energy instead.
                if (creep.pos.x == creep.memory.fixedDropoffSpot.x && creep.pos.y == creep.memory.fixedDropoffSpot.y) {
                    creep.drop(RESOURCE_ENERGY);
                } else {
                    creep.moveTo(creep.memory.fixedDropoffSpot.x, creep.memory.fixedDropoffSpot.y);
                }
            }
            else {
                creep.memory.deliverTarget = null;
            }
        }
        return true;
    },

    /** @param {Creep} creep **/
    run: function (creep) {
        if (creep.memory.delivering && creep.carry.energy == 0) {
            creep.memory.delivering = false;
            creep.memory.buildTarget = null;
            delete creep.memory.tempRole;
        }
        else if (!creep.memory.delivering && creep.carry.energy == creep.carryCapacity) {
            creep.memory.delivering = true;
            creep.memory.resourceTarget = null;
            delete creep.memory.tempRole;
        }

        if (!creep.memory.delivering) {
            return roleHarvester.harvest(creep);
        }
        else {
            return roleHarvester.deliver(creep);
        }
    },

    spawn: function (spawner, force, maxSize) {
        var bodyWeights = {move: 0.1, work: 0.7, carry: 0.2};
        var cost = 0;
        if (maxSize) {
            // With theoretically unlimites energy, check how expensive the creep can become with maxSize.
            var tempBody = utilities.generateCreepBody(bodyWeights, spawner.room.energyCapacityAvailable, {work: maxSize});
            for (var i in tempBody) {
                cost += BODYPART_COST[tempBody[i]];
            }
        }

        if ((spawner.room.energyAvailable >= Math.min(spawner.room.energyCapacityAvailable * 0.9, (maxSize ? cost : 99999)) || (force && spawner.room.energyAvailable >= 200)) && !spawner.spawning) {
            var body = utilities.generateCreepBody(bodyWeights, spawner.room.energyAvailable, maxSize ? {work: maxSize} : undefined);
            if (spawner.canCreateCreep(body) == OK) {
                var newName = spawner.createCreep(body, undefined, {role: 'harvester'});
                console.log('Spawning new harvester: ' + newName);
                return true;
            }
        }
        return false;
    }
};

module.exports = roleHarvester;
