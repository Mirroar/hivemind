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
        else if (creep.memory.fixedMineralSource) {
            source = Game.getObjectById(creep.memory.fixedMineralSource);
            // @todo Just in case, handle source not existing anymore, or missing extractor.
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

        if (creep.memory.fixedMineralSource) {
            var source = Game.getObjectById(creep.memory.fixedMineralSource);
            // By default, deliver to room's terminal if there's space.
            if (creep.room.terminal && _.sum(creep.room.terminal.store) < creep.room.terminal.storeCapacity) {
                var result = creep.transfer(creep.room.terminal, source.mineralType);
                if (result == ERR_NOT_IN_RANGE) {
                    creep.moveTo(creep.room.terminal);
                }
            }
            else if (creep.room.storage && _.sum(creep.room.storage.store) < creep.room.storage.storeCapacity) {
                var result = creep.transfer(creep.room.storage, source.mineralType);
                if (result == ERR_NOT_IN_RANGE) {
                    creep.moveTo(creep.room.storage);
                }
            }
            else {
                // @todo Drop on storage point, I guess? We probably shouldn't be collecting minerals if we have no place to store them.
            }

            return true;
        }
        else if (creep.memory.fixedTarget && gameState.getNumTransporters(creep.pos.roomName) > 0) {
            // Drop off in link or container.
            var sourceMemory = creep.room.memory.sources[creep.memory.fixedSource];
            if (sourceMemory && sourceMemory.targetLink && gameState.getStoredEnergy(creep.room) > 10000) {
                target = Game.getObjectById(sourceMemory.targetLink);
                if (!target || target.energy >= target.energyCapacity) {
                    target = null;
                }
            }

            //console.log(gameState.getNumTransporters(creep.pos.roomName), 'transporters found...', creep.pos.roomName);
            if (!target) {
                target = Game.getObjectById(creep.memory.fixedTarget);
            }
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
        if (creep.memory.delivering && _.sum(creep.carry) <= 0) {
            creep.memory.delivering = false;
            delete creep.memory.tempRole;
        }
        else if (!creep.memory.delivering && _.sum(creep.carry) >= creep.carryCapacity) {
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

};

module.exports = roleHarvester;
