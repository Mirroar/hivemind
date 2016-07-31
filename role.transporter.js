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

    getAvailableEnergySources: function (creep) {
        var options = [];
        // Energy can be gotten at the room's storage.
        if (creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] >= creep.carryCapacity - creep.carry[RESOURCE_ENERGY]) {
            options.push({
                priority: creep.memory.role == 'transporter' ? 0 : 5,
                weight: 0,
                type: 'structure',
                object: creep.room.storage,
            });
        }

        // Get storage location, since that is a low priority source for transporters.
        // @todo It will probably need to be again, if other sources are empty.
        var storagePosition = utilities.getStorageLocation(creep.room);

        // Look for energy on the ground.
        var targets = creep.room.find(FIND_DROPPED_ENERGY, {
            filter: (resource) => {
                if (resource.resourceType == RESOURCE_ENERGY) {
                    if (creep.pos.findPathTo(resource)) {
                        return true;
                    }
                }
                return false;
            }
        });

        for (var i in targets) {
            var target = targets[i];
            var option = {
                priority: 4,
                weight: target.amount / 100, // @todo Also factor in distance.
                type: 'resource',
                object: target,
            };

            if (target.pos.x == storagePosition.x && target.pos.y == storagePosition.y) {
                if (creep.memory.role == 'transporter') {
                    option.priority = 0;
                }
                else {
                    option.priority = 5;
                }
            }

            options.push(option);
        }

        // Look for energy in Containers.
        var targets = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return (structure.structureType == STRUCTURE_CONTAINER) && (structure.store[RESOURCE_ENERGY] > 0);
            }
        });

        // Prefer containers used as harvester dropoff.
        for (var i in targets) {
            var target = targets[i];
            var option = {
                priority: 2,
                weight: target.store[RESOURCE_ENERGY] / 100, // @todo Also factor in distance.
                type: 'structure',
                object: target,
            };

            if (target.room.memory.sources) {
                for (var id in target.room.memory.sources) {
                    if (target.room.memory.sources[id].targetContainer && target.room.memory.sources[id].targetContainer == target.id) {
                        option.priority = 3;
                        break;
                    }
                }
            }

            options.push(option);
        }

        return options;
    },

    getBestEnergySource: function (creep) {
        var options = roleTransporter.getAvailableEnergySources(creep);

        var best = null;

        for (var i in options) {
            if (!best || options[i].priority > best.priority || (options[i].priority == best.priority && options[i].weight > best.weight)) {
                best = options[i];
            }
        }

        return best;
    },

    getEnergy: function (creep) {
        //creep.memory.sourceTarget = null;
        if (!creep.memory.sourceTarget) {
            /*var best = roleTransporter.getBestEnergySource(creep);

            if (best) {
                creep.memory.sourceTarget = best.object.id;
            }//*/

            if (creep.memory.role != 'transporter' && creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] >= creep.carryCapacity - creep.carry[RESOURCE_ENERGY]) {
                creep.memory.sourceTarget = creep.room.storage.id;
            }
            else {
                // Get storage location, since that is no valid source for transporters.
                // @todo It will probably need to be again, if other sources are empty.
                var storagePosition = utilities.getStorageLocation(creep.room);

                // Look for energy in harvester dropoff-spots, first.
                var targets = creep.room.find(FIND_DROPPED_ENERGY, {
                    filter: (resource) => {
                        // @todo Temporarily diabled. First, we need to be able to ignore energy outside our walls.
                        return false;

                        if (resource.resourceType == RESOURCE_ENERGY) {
                            if (creep.memory.role == 'transporter' && resource.pos.x == storagePosition.x && resource.pos.y == storagePosition.y) {
                                return false;
                            }
                            return true;
                        }
                        return false;
                    }
                });

                // Prefer resources used as harvester dropoff.
                var dropOffs = _.filter(targets, (target) => {
                    if (!target.room.memory.sources) {
                        return false;
                    }
                    for (var id in target.room.memory.sources) {
                        if (target.room.memory.sources[id].dropoffSpot.x == target.pos.x && target.room.memory.sources[id].dropoffSpot.y == target.pos.y) {
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

                if (targets.length <= 0) {
                    // Look for energy in Containers, primarily.
                    var targets = creep.room.find(FIND_STRUCTURES, {
                        filter: (structure) => {
                            return (structure.structureType == STRUCTURE_CONTAINER) && (structure.store[RESOURCE_ENERGY] > 0);
                        }
                    });
                    if (targets.length <= 0) {
                        if (creep.memory.role == 'transporter' && creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 0) {
                            // If no other sources are available, use storage as transporter source (for refilling spawn, etc.).
                            creep.memory.sourceTarget = creep.room.storage.id;
                        }
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
            }//*/
        }
        var best = creep.memory.sourceTarget;
        if (!best) {
            if (creep.memory.role == 'transporter' && creep.carry[RESOURCE_ENERGY] > 0) {
                // Deliver what energy we already have stored, if no more can be found for picking up.
                creep.memory.delivering = true;
            }
            return false;
        }
        var target = Game.getObjectById(best);
        if (!target || (target.store && target.store[RESOURCE_ENERGY] <= 0) || (target.amount && target.amount <= 0)) {
            creep.memory.sourceTarget = null;
        }
        else if (target.store && target.transfer(creep, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
            creep.moveTo(target);
        }
        else if (target.amount && creep.pickup(target) == ERR_NOT_IN_RANGE) {
            creep.moveTo(target);
        }
        return true;
    },

    deliverEnergy: function (creep) {
        if (!creep.memory.deliverTarget) {
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
                            if (structure.room.memory.sources) {
                                for (var id in structure.room.memory.sources) {
                                    if (structure.room.memory.sources[id].targetContainer == structure.id) {
                                        return false;
                                    }
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
                        if (creep.room.storage) {
                            creep.memory.deliverTarget = creep.room.storage.id;
                        }
                        else {
                            var storagePosition = utilities.getStorageLocation(creep.room);
                            if (storagePosition) {
                                creep.memory.deliverTarget = storagePosition;
                            }
                            else {
                                return false;
                            }
                        }
                    }
                }
            }

            if (!creep.memory.deliverTarget) {
                creep.memory.deliverTarget = utilities.getClosest(creep, targets);
            }
        }
        var best = creep.memory.deliverTarget;
        if (!best) {
            return false;
        }
        if (typeof best == 'string') {
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
        }
        else if (best.x) {
            // Dropoff location.
            if (creep.pos.x == best.x && creep.pos.y == best.y) {
                creep.drop(RESOURCE_ENERGY);
            } else {
                creep.moveTo(best.x, best.y);
            }
            return true;

        }
        else {
            // Unknown target type, reset!
            console.log('Unknown target type found!');
            console.log(creep.memory.deliverTarget);
            creep.memory.deliverTarget = null;
        }
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
        var maxSize = 600;
        if ((spawner.room.energyAvailable >= Math.min(maxSize, spawner.room.energyCapacityAvailable * 0.9) || (force && spawner.room.energyAvailable >= 250)) && !spawner.spawning) {
            var body = utilities.generateCreepBody({move: 0.5, carry: 0.5}, Math.min(maxSize, spawner.room.energyAvailable));
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