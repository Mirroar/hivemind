/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('role.builder');
 * mod.thing == 'a thing'; // true
 */

var creepGeneral = require('creep.general');
var utilities = require('utilities');

var roleTransporter = {

    /**
     * Creates a priority list of energy sources available to this creep.
     */
    getAvailableEnergySources: function (creep) {
        var options = [];
        // Energy can be gotten at the room's storage.
        if (creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] >= creep.carryCapacity - _.sum(creep.carry)) {
            options.push({
                priority: creep.memory.role == 'transporter' ? 0 : 5,
                weight: 0,
                type: 'structure',
                object: creep.room.storage,
            });
        }

        // Get storage location, since that is a low priority source for transporters.
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
            else {
                option.priority -= creepGeneral.getCreepsWithOrder('getEnergy', target.id).length * 3;
            }

            options.push(option);
        }

        // Look for energy in Containers.
        var targets = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return (structure.structureType == STRUCTURE_CONTAINER) && (structure.store[RESOURCE_ENERGY] > 0 && structure.id != creep.room.memory.controllerContainer);
            }
        });

        // Prefer containers used as harvester dropoff.
        for (var i in targets) {
            var target = targets[i];

            // Actually, don't use other containers, only those with harvesters are a valid source.
            var option = {
                priority: -1,
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

            option.priority -= creepGeneral.getCreepsWithOrder('getEnergy', target.id).length * 2;

            options.push(option);
        }

        return options;
    },

    /**
     * Creates a priority list of possible delivery targets for this creep.
     */
    getAvailableDeliveryTargets: function (creep) {
        var options = [];

        // Primarily fill spawn and extenstions.
        var targets = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return (structure.structureType == STRUCTURE_EXTENSION ||
                        structure.structureType == STRUCTURE_SPAWN) && structure.energy < structure.energyCapacity;
            }
        });

        for (var i in targets) {
            var target = targets[i];
            var option = {
                priority: 5,
                weight: (target.energyCapacity - target.energy) / 100,
                type: 'structure',
                object: target,
            };

            option.weight += 1 - (creep.pos.getRangeTo(target) / 100);
            option.priority -= creepGeneral.getCreepsWithOrder('deliverEnergy', target.id).length * 3;

            options.push(option);
        }

        // Fill containers.
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

        for (var i in targets) {
            var target = targets[i];
            var option = {
                priority: 4,
                weight: (target.storeCapacity - target.store[RESOURCE_ENERGY]) / 100, // @todo Also factor in distance, and other resources.
                type: 'structure',
                object: target,
            };

            var prioFactor = 1;
            if (target.store[RESOURCE_ENERGY] / target.storeCapacity > 0.5) {
                prioFactor = 2;
            }
            else if (target.store[RESOURCE_ENERGY] / target.storeCapacity > 0.75) {
                prioFactor = 3;
            }

            option.priority -= creepGeneral.getCreepsWithOrder('deliverEnergy', target.id).length * prioFactor;

            options.push(option);
        }

        // Supply towers.
        var targets = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return (structure.structureType == STRUCTURE_TOWER) && structure.energy < structure.energyCapacity * 0.8;
            }
        });

        for (var i in targets) {
            var target = targets[i];
            var option = {
                priority: 3,
                weight: (target.energyCapacity - target.energy) / 100, // @todo Also factor in distance.
                type: 'structure',
                object: target,
            };

            option.priority -= creepGeneral.getCreepsWithOrder('deliverEnergy', target.id).length * 2;

            options.push(option);
        }

        // Deliver excess energy to storage.
        if (creep.room.storage) {
            options.push({
                priority: 0,
                weight: 0,
                type: 'structure',
                object: creep.room.storage,
            });
        }
        else {
            var storagePosition = utilities.getStorageLocation(creep.room);
            if (storagePosition) {
                options.push({
                    priority: 0,
                    weight: 0,
                    type: 'position',
                    object: creep.room.getPositionAt(storagePosition.x, storagePosition.y),
                });
            }
        }

        return options;
    },

    /**
     * Sets a good energy source target for this creep.
     */
    calculateEnergySource: function (creep) {
        var best = utilities.getBestOption(roleTransporter.getAvailableEnergySources(creep));

        if (best) {
            //console.log('best energy source for this', creep.memory.role , ':', best.type, best.object.id, '@ priority', best.priority, best.weight);
            creep.memory.sourceTarget = best.object.id;

            creep.memory.order = {
                type: 'getEnergy',
                target: best.object.id
            };
        }
        else {
            delete creep.memory.sourceTarget;
            delete creep.memory.order;
        }
    },

    /**
     * Makes this creep collect energy.
     */
    getEnergy: function (creep) {
        //creep.memory.sourceTarget = null;
        if (!creep.memory.sourceTarget) {
            roleTransporter.calculateEnergySource(creep);
        }

        var best = creep.memory.sourceTarget;
        if (!best) {
            if (creep.memory.role == 'transporter' && creep.carry[RESOURCE_ENERGY] > 0) {
                // Deliver what energy we already have stored, if no more can be found for picking up.
                roleTransporter.setDelivering(creep, true);
            }
            return false;
        }
        var target = Game.getObjectById(best);
        if (!target || (target.store && target.store[RESOURCE_ENERGY] <= 0) || (target.amount && target.amount <= 0)) {
            roleTransporter.calculateEnergySource(creep);
        }
        else if (target.store && target.transfer(creep, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
            creep.moveTo(target);
        }
        else if (target.amount && creep.pickup(target) == ERR_NOT_IN_RANGE) {
            creep.moveTo(target);
        }
        return true;
    },

    /**
     * Sets a good energy delivery target for this creep.
     */
    calculateEnergyTarget: function (creep) {
        var best = utilities.getBestOption(roleTransporter.getAvailableDeliveryTargets(creep));

        if (best) {
            //console.log('energy for this', creep.memory.role , 'should be delivered to:', best.type, best.object.id, '@ priority', best.priority, best.weight);
            if (best.type == 'position') {
                creep.memory.deliverTarget = {x: best.object.x, y: best.object.y};

                creep.memory.order = {
                    type: 'deliverEnergy',
                    target: utilities.encodePosition(best.object)
                };
            }
            else {
                creep.memory.deliverTarget = best.object.id;

                creep.memory.order = {
                    type: 'deliverEnergy',
                    target: best.object.id
                };
            }
        }
        else {
            delete creep.memory.deliverTarget;
        }
    },

    /**
     * Makes this creep deliver carried energy somewhere.
     */
    deliverEnergy: function (creep) {
        if (!creep.memory.deliverTarget) {
            roleTransporter.calculateEnergyTarget(creep);
        }
        var best = creep.memory.deliverTarget;
        if (!best) {
            return false;
        }
        if (typeof best == 'string') {
            var target = Game.getObjectById(best);
            if (!target) {
                roleTransporter.calculateEnergyTarget(creep);
            }

            var result = creep.transfer(target, RESOURCE_ENERGY);
            if (result == ERR_NOT_IN_RANGE) {
                creep.moveTo(target);
            }
            if (target.energy >= target.energyCapacity || (target.store && target.store.energy >= target.storeCapacity)) {
                roleTransporter.calculateEnergyTarget(creep);
            }
            return true;
        }
        else if (best.x) {
            // Dropoff location.
            if (creep.pos.x == best.x && creep.pos.y == best.y) {
                creep.drop(RESOURCE_ENERGY);
            } else {
                var result = creep.moveTo(best.x, best.y);
                //console.log(result);
                if (result == ERR_NO_PATH) {
                    if (!creep.memory.blockedPathCounter) {
                        creep.memory.blockedPathCounter = 0;
                    }
                    creep.memory.blockedPathCounter++;

                    if (creep.memory.blockedPathCounter > 10) {
                        roleTransporter.calculateEnergyTarget(creep);
                    }
                }
                else {
                    delete creep.memory.blockedPathCounter;
                }
            }
            return true;

        }
        else {
            // Unknown target type, reset!
            console.log('Unknown target type for energy delivery found!');
            console.log(creep.memory.deliverTarget);
            delete creep.memory.deliverTarget;
        }
    },

    /**
     * Puts this creep into or out of delivery mode.
     */
    setDelivering: function (creep, delivering) {
        creep.memory.delivering = delivering;
        delete creep.memory.sourceTarget;
        delete creep.memory.order;
        delete creep.memory.deliverTarget;
        delete creep.memory.tempRole;
    },

    /** @param {Creep} creep **/
    run: function (creep) {
        if (_.sum(creep.carry) >= creep.carryCapacity * 0.9 && !creep.memory.delivering) {
            roleTransporter.setDelivering(creep, true);
        }
        else if (creep.carry[RESOURCE_ENERGY] <= 0 && creep.memory.delivering) {
            roleTransporter.setDelivering(creep, false);
        }

        if (!creep.memory.delivering) {
            return roleTransporter.getEnergy(creep);
        }
        else {
            return roleTransporter.deliverEnergy(creep);
        }

        return true;
    },

};

module.exports = roleTransporter;
