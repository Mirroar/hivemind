/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('role.harvester');
 * mod.thing == 'a thing'; // true
 */

// @todo When road is built, send harvester with low move _and_ carry, and let it build a container. Then, send transporters.
// @todo Record time it takes to get to source, so a new harvester can be built in time.
// @todo Collect energy if it's lying on the path.

var utilities = require('utilities');
var roleRemoteHarvester = require('role.harvester.remote');

var roleHauler = {

    harvest: function (creep) {
        var source;
        var actionTaken = false;
        if (creep.memory.source) {
            var sourcePosition = utilities.decodePosition(creep.memory.source);
            var harvestMemory = Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[creep.memory.source];
            if (sourcePosition.roomName != creep.pos.roomName) {
                creep.moveTo(sourcePosition);
                return true;
            }

            // Check if energy is on the ground nearby and pick that up.
            var resource = creep.pos.findClosestByRange(FIND_DROPPED_ENERGY, {
                filter: (resource) => resource.resourceType == RESOURCE_ENERGY
            });
            if (resource && creep.pos.getRangeTo(resource) <= 3) {
                if (creep.pickup(resource) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(resource);
                    return true;
                }
                actionTaken = true;
            }

            if (harvestMemory.hasContainer) {
                var container = Game.getObjectById(harvestMemory.containerId);

                if (container) {
                    if (actionTaken) {
                        creep.moveTo(container);
                        return true;
                    }
                    else {
                        var result = creep.withdraw(container, RESOURCE_ENERGY);
                        if (result == ERR_NOT_IN_RANGE || result == ERR_NOT_ENOUGH_RESOURCES) {
                            creep.moveTo(container);
                        }
                        actionTaken = true;
                    }
                }
            }

            // Also lighten the load of harvesters nearby.
            var harvester = sourcePosition.findClosestByRange(FIND_CREEPS, {
                filter: (creep) => creep.my && creep.memory.role == 'harvester.remote' && creep.carry.energy > 0
            });
            if (harvester && !actionTaken) {
                if (harvester.transfer(creep, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(harvester);
                }
            }
        }
        else if (creep.memory.sourceContainer) {

        }

        return true;
    },

    deliver: function (creep) {
        var sourcePos = utilities.decodePosition(creep.memory.source);
        var harvestMemory = Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[creep.memory.source];

        var target;
        var targetPosition = utilities.decodePosition(creep.memory.storage);
        if (targetPosition.roomName != creep.pos.roomName) {
            creep.moveTo(targetPosition);

            return true;
        }
        // @todo If no storage is available, use default delivery method.
        target = creep.room.storage;

        if (!target || _.sum(target.store) + creep.carry.energy >= target.storeCapacity) {
            // Container is full, drop energy instead.
            if (creep.room.memory.storage) {
                if (creep.pos.x != creep.room.memory.storage.x || creep.pos.y != creep.room.memory.storage.y) {
                    let result = creep.moveTo(creep.room.memory.storage.x, creep.room.memory.storage.y);
                    if (result == ERR_NO_PATH) {
                        // Cannot reach dropoff spot, just drop energy right here then.
                        if (creep.drop(RESOURCE_ENERGY) == OK) {
                            // If there's no place to deliver, just drop the energy on the spot, somebody will probably pick it up.
                            harvestMemory.revenue += creep.carry.energy;
                            return true;
                        }
                    }
                }
                else {
                    // Dropoff spot reached, drop energy.
                    if (creep.drop(RESOURCE_ENERGY) == OK) {
                        // If there's no place to deliver, just drop the energy on the spot, somebody will probably pick it up.
                        harvestMemory.revenue += creep.carry.energy;
                        return true;
                    }
                }
            }
            else if (creep.drop(RESOURCE_ENERGY) == OK) {
                // If there's no place to deliver, just drop the energy on the spot, somebody will probably pick it up.
                harvestMemory.revenue += creep.carry.energy;
                return true;
            }
        }

        var result = creep.transfer(target, RESOURCE_ENERGY);
        if (result == OK) {
            // @todo This might be wrong if energy only fits into container partially.
            harvestMemory.revenue += creep.carry.energy;
        }
        else if (result == ERR_NOT_IN_RANGE) {
            creep.moveTo(target);
        }

        return true;
    },

    setHarvesting: function (creep, harvesting) {
        creep.memory.harvesting = harvesting;
    },

    /** @param {Creep} creep **/
    run: function (creep) {
        if (!creep.memory.harvesting && creep.carry.energy == 0) {
            roleHauler.setHarvesting(creep, true);
        }
        else if (creep.memory.harvesting && _.sum(creep.carry) >= creep.carryCapacity * 0.9) {
            roleHauler.setHarvesting(creep, false);
        }

        // Repair / build roads, even when just waiting for more energy.
        var targetPosition = utilities.decodePosition(creep.memory.storage);
        if (targetPosition.roomName != creep.pos.roomName) {
            if (roleRemoteHarvester.buildRoad(creep)) {
                //return true;
            }
        }
        if (creep.memory.harvesting) {
            return roleHauler.harvest(creep);
        }
        else {
            return roleHauler.deliver(creep);
        }
    },

};

module.exports = roleHauler;
