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

/**
 * Creates a priority list of energy sources available to this creep.
 */
Creep.prototype.getAvailableEnergySources = function () {
    var creep = this;
    var storage = this.room.storage;
    var options = [];
    // Energy can be gotten at the room's storage.
    if (storage && storage.store[RESOURCE_ENERGY] >= creep.carryCapacity - _.sum(creep.carry)) {
        options.push({
            priority: creep.memory.role == 'transporter' ? 0 : 5,
            weight: 0,
            type: 'structure',
            object: storage,
            resourceType: RESOURCE_ENERGY,
        });
    }

    // Get storage location, since that is a low priority source for transporters.
    var storagePosition = creep.room.getStorageLocation();

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
            resourceType: RESOURCE_ENERGY,
        };

        if (storagePosition && target.pos.x == storagePosition.x && target.pos.y == storagePosition.y) {
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
            return (structure.structureType == STRUCTURE_CONTAINER) && structure.store[RESOURCE_ENERGY] > creep.carryCapacity * 0.1;
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
            resourceType: RESOURCE_ENERGY,
        };

        if (target.room.memory.sources) {
            for (var id in target.room.memory.sources) {
                if (target.room.memory.sources[id].targetContainer && target.room.memory.sources[id].targetContainer == target.id) {
                    option.priority = 3;
                    break;
                }
            }
        }

        option.priority -= creepGeneral.getCreepsWithOrder('getEnergy', target.id).length * 3;

        options.push(option);
    }

    return options;
};

/**
 * Creates a priority list of resources available to this creep.
 */
Creep.prototype.getAvailableSources = function () {
    var creep = this;
    var options = creep.getAvailableEnergySources();

    // Clear out overfull terminal.
    let terminal = creep.room.terminal;
    if (terminal && _.sum(terminal.store) - terminal.store.energy > terminal.storeCapacity * 0.8) {
        // Find resource with highest count and take that.
        // @todo Unless it's supposed to be sent somewhere else.
        let max = null;
        let maxResourceType = null;
        for (let resourceType in terminal.store) {
            if (!max || terminal.store[resourceType] > max) {
                max = terminal.store[resourceType];
                maxResourceType = resourceType;
            }
        }

        options.push({
            priority: 1,
            weight: 0,
            type: 'structure',
            object: terminal,
            resourceType: maxResourceType,
        });
    }

    // @todo Take resources from storage if terminal is relatively empty.

    if (creep.room.memory.canPerformReactions) {
        // Clear out reaction lab.
        let lab = Game.getObjectById(creep.room.memory.labs.reactor);
        if (lab && lab.mineralAmount > 0) {
            let option = {
                priority: 2,
                weight: lab.mineralAmount / lab.mineralCapacity,
                type: 'structure',
                object: lab,
                resourceType: lab.mineralType,
            };

            if (lab.mineralAmount > lab.mineralCapacity * 0.5) {
                option.priority++;
            }
            if (lab.mineralAmount > lab.mineralCapacity * 0.8) {
                option.priority++;
            }

            options.push(option);
        }

        // Clear out labs with wrong resources.
        lab = Game.getObjectById(creep.room.memory.labs.source1);
        if (lab && lab.mineralAmount > 0 && creep.room.memory.currentReaction && lab.mineralType != creep.room.memory.currentReaction[0]) {
            let option = {
                priority: 4,
                weight: 0,
                type: 'structure',
                object: lab,
                resourceType: lab.mineralType,
            };

            options.push(option);
        }
        lab = Game.getObjectById(creep.room.memory.labs.source2);
        if (lab && lab.mineralAmount > 0 && creep.room.memory.currentReaction && lab.mineralType != creep.room.memory.currentReaction[1]) {
            let option = {
                priority: 4,
                weight: 0,
                type: 'structure',
                object: lab,
                resourceType: lab.mineralType,
            };

            options.push(option);
        }

        // Get reaction resources from terminal.
        if (creep.room.memory.currentReaction) {
            lab = Game.getObjectById(creep.room.memory.labs.source1);
            if (lab && (!lab.mineralType || lab.mineralType == creep.room.memory.currentReaction[0]) && lab.mineralAmount < lab.mineralCapacity * 0.5) {
                let option = {
                    priority: 4,
                    weight: 1 - lab.mineralAmount / lab.mineralCapacity,
                    type: 'structure',
                    object: terminal,
                    resourceType: creep.room.memory.currentReaction[0],
                };

                if (lab.mineralAmount > lab.mineralCapacity * 0.2) {
                    option.priority--;
                }

                options.push(option);
            }
            lab = Game.getObjectById(creep.room.memory.labs.source2);
            if (lab && (!lab.mineralType || lab.mineralType == creep.room.memory.currentReaction[1]) && lab.mineralAmount < lab.mineralCapacity * 0.5) {
                let option = {
                    priority: 4,
                    weight: 1 - lab.mineralAmount / lab.mineralCapacity,
                    type: 'structure',
                    object: terminal,
                    resourceType: creep.room.memory.currentReaction[1],
                };

                if (lab.mineralAmount > lab.mineralCapacity * 0.2) {
                    option.priority--;
                }

                options.push(option);
            }
        }

        // @todo Get reaction resources from storage.
    }

    return options;
};

/**
 * Sets a good energy source target for this creep.
 */
Creep.prototype.calculateEnergySource = function () {
    var creep = this;
    var best = utilities.getBestOption(creep.getAvailableEnergySources());

    if (best) {
        //console.log('best energy source for this', creep.memory.role , ':', best.type, best.object.id, '@ priority', best.priority, best.weight);
        creep.memory.sourceTarget = best.object.id;

        creep.memory.order = {
            type: 'getEnergy',
            target: best.object.id,
            resourceType: best.resourceType,
        };
    }
    else {
        delete creep.memory.sourceTarget;
        delete creep.memory.order;
    }
};

/**
 * Sets a good resource source target for this creep.
 */
Creep.prototype.calculateSource = function () {
    var creep = this;
    var best = utilities.getBestOption(creep.getAvailableSources());

    if (best) {
        //console.log('best source for this', creep.memory.role , ':', best.type, best.object.id, '@ priority', best.priority, best.weight);
        creep.memory.sourceTarget = best.object.id;

        creep.memory.order = {
            type: 'getResource',
            target: best.object.id,
            resourceType: best.resourceType,
        };

        /*if (creep.pos.roomName == 'E49S47') {
            console.log('new target:', best.priority, best.weight, best.resourceType, creep.pos.roomName);
        }//*/
    }
    else {
        delete creep.memory.sourceTarget;
        delete creep.memory.order;
    }
};

/**
 * Makes this creep collect energy.
 */
Creep.prototype.performGetEnergy = function () {
    var creep = this;
    //creep.memory.sourceTarget = null;
    if (!creep.memory.sourceTarget) {
        creep.calculateEnergySource();
    }

    var best = creep.memory.sourceTarget;
    if (!best) {
        if (creep.memory.role == 'transporter' && creep.carry[RESOURCE_ENERGY] > 0) {
            // Deliver what energy we already have stored, if no more can be found for picking up.
            creep.setTransporterState(true);
        }
        return false;
    }
    var target = Game.getObjectById(best);
    if (!target || (target.store && target.store[RESOURCE_ENERGY] <= 0) || (target.amount && target.amount <= 0) || (target.mineralAmount && target.mineralAmount <= 0)) {
        creep.calculateEnergySource();
    }
    else if (target.store) {
        if (creep.pos.getRangeTo(target) > 1) {
            creep.moveTo(target);
        }
        else {
            let result = creep.withdraw(target, RESOURCE_ENERGY);
            if (result == OK) {
                creep.calculateEnergySource();
            }
        }
    }
    else if (target.amount) {
        if (creep.pos.getRangeTo(target) > 1) {
            creep.moveTo(target);
        }
        else {
            let result = creep.pickup(target);
            if (result == OK) {
                creep.calculateEnergySource();
            }
        }
    }
    return true;
};

/**
 * Makes this creep collect resources.
 */
Creep.prototype.performGetResources = function () {
    var creep = this;
    //creep.memory.sourceTarget = null;
    if (!creep.memory.sourceTarget) {
        creep.calculateSource();
    }

    var best = creep.memory.sourceTarget;
    if (!best) {
        if (creep.memory.role == 'transporter' && _.sum(creep.carry) > 0) {
            // Deliver what we already have stored, if no more can be found for picking up.
            creep.setTransporterState(true);
        }
        return false;
    }
    var target = Game.getObjectById(best);
    if (!target || (target.store && _.sum(target.store) <= 0) || (target.amount && target.amount <= 0) || (target.mineralAmount && target.mineralAmount <= 0)) {
        creep.calculateSource();
    }
    else if (target.store) {
        if (creep.pos.getRangeTo(target) > 1) {
            creep.moveTo(target);
        }
        else {
            let result = creep.withdraw(target, creep.memory.order.resourceType);
            if (result == OK) {
                creep.calculateEnergySource();
            }
        }
    }
    else if (target.amount) {
        if (creep.pos.getRangeTo(target) > 1) {
            creep.moveTo(target);
        }
        else {
            let result = creep.pickup(target);
            if (result == OK) {
                creep.calculateEnergySource();
            }
        }
    }
    else if (target.mineralAmount) {
        if (creep.pos.getRangeTo(target) > 1) {
            creep.moveTo(target);
        }
        else {
            let result = creep.withdraw(target, creep.memory.order.resourceType);
            if (result == OK) {
                creep.calculateEnergySource();
            }
        }
    }
    return true;
};

/**
 * Creates a priority list of possible delivery targets for this creep.
 */
Creep.prototype.getAvailableDeliveryTargets = function () {
    var creep = this;
    var options = [];

    let terminal = creep.room.terminal;
    let storage = creep.room.storage;

    if (creep.carry.energy > creep.carryCapacity * 0.1) {
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
                resourceType: RESOURCE_ENERGY,
            };

            option.weight += 1 - (creep.pos.getRangeTo(target) / 100);
            option.priority -= creepGeneral.getCreepsWithOrder('deliver', target.id).length * 3;

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
                resourceType: RESOURCE_ENERGY,
            };

            var prioFactor = 1;
            if (target.store[RESOURCE_ENERGY] / target.storeCapacity > 0.5) {
                prioFactor = 2;
            }
            else if (target.store[RESOURCE_ENERGY] / target.storeCapacity > 0.75) {
                prioFactor = 3;
            }

            option.priority -= creepGeneral.getCreepsWithOrder('deliver', target.id).length * prioFactor;

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
                resourceType: RESOURCE_ENERGY,
            };

            option.priority -= creepGeneral.getCreepsWithOrder('deliver', target.id).length * 2;

            options.push(option);
        }

        // Supply terminal with excess energy.
        if (terminal && _.sum(terminal.store) < terminal.storeCapacity) {
            if (creep.room.storage && terminal.store.energy < storage.store.energy * 0.1) {
                let option = {
                    priority: 2,
                    weight: 0,
                    type: 'structure',
                    object: terminal,
                    resourceType: RESOURCE_ENERGY,
                };

                if (terminal.store.energy < 5000) {
                    option.priority += 2;
                }

                options.push(option);
            }
        }

        // Deliver excess energy to storage.
        if (storage) {
            options.push({
                priority: 0,
                weight: 0,
                type: 'structure',
                object: storage,
                resourceType: RESOURCE_ENERGY,
            });
        }
        else {
            var storagePosition = creep.room.getStorageLocation();
            if (storagePosition) {
                options.push({
                    priority: 0,
                    weight: 0,
                    type: 'position',
                    object: creep.room.getPositionAt(storagePosition.x, storagePosition.y),
                    resourceType: RESOURCE_ENERGY,
                });
            }
        }

        // Deliver energy to storage link.
        if (creep.room.memory.storageLink) {
            var target = Game.getObjectById(creep.room.memory.storageLink);
            if (target && target.energy < target.energyCapacity) {
                options.push({
                    priority: 2,
                    weight: (target.energyCapacity - target.energy) / 100, // @todo Also factor in distance.
                    type: 'structure',
                    object: target,
                    resourceType: RESOURCE_ENERGY,
                });
            }
        }
    }

    for (let resourceType in creep.carry) {
        if (resourceType == RESOURCE_ENERGY || creep.carry[resourceType] <= 0) {
            continue;
        }

        // If there is space left, store in terminal.
        if (creep.room.terminal && _.sum(creep.room.terminal.store) < creep.room.terminal.storeCapacity) {
            var option = {
                priority: 0,
                weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
                type: 'structure',
                object: creep.room.terminal,
                resourceType: resourceType,
            };

            if (_.sum(creep.room.terminal.store) - creep.room.terminal.store.energy < creep.room.terminal.storeCapacity * 0.7) {
                option.priority = 3;
            }

            options.push(option);
        }

        // If there is space left, store in storage.
        if (storage && _.sum(storage.store) < storage.storeCapacity) {
            options.push({
                priority: 1,
                weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
                type: 'structure',
                object: storage,
                resourceType: resourceType,
            });
        }

        // Put correct resources into labs.
        if (creep.room.memory.currentReaction) {
            if (resourceType == creep.room.memory.currentReaction[0]) {
                let lab = Game.getObjectById(creep.room.memory.labs.source1);
                if (lab && (!lab.mineralType || lab.mineralType == resourceType) && lab.mineralAmount < lab.mineralCapacity * 0.8) {
                    options.push({
                        priority: 4,
                        weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
                        type: 'structure',
                        object: lab,
                        resourceType: resourceType,
                    });
                }
            }
            if (resourceType == creep.room.memory.currentReaction[1]) {
                let lab = Game.getObjectById(creep.room.memory.labs.source2);
                if (lab && (!lab.mineralType || lab.mineralType == resourceType) && lab.mineralAmount < lab.mineralCapacity * 0.8) {
                    options.push({
                        priority: 4,
                        weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
                        type: 'structure',
                        object: lab,
                        resourceType: resourceType,
                    });
                }
            }
        }
    }

    return options;
};

/**
 * Sets a good energy delivery target for this creep.
 */
Creep.prototype.calculateDeliveryTarget = function () {
    var creep = this;
    var best = utilities.getBestOption(creep.getAvailableDeliveryTargets());

    if (best) {
        //console.log('energy for this', creep.memory.role , 'should be delivered to:', best.type, best.object.id, '@ priority', best.priority, best.weight);
        if (best.type == 'position') {
            creep.memory.deliverTarget = {x: best.object.x, y: best.object.y};

            creep.memory.order = {
                type: 'deliver',
                target: utilities.encodePosition(best.object),
                resourceType: best.resourceType,
            };
        }
        else {
            creep.memory.deliverTarget = best.object.id;

            creep.memory.order = {
                type: 'deliver',
                target: best.object.id,
                resourceType: best.resourceType,
            };
        }
    }
    else {
        delete creep.memory.deliverTarget;
    }
};

/**
 * Makes this creep deliver carried energy somewhere.
 */
Creep.prototype.performDeliver = function () {
    var creep = this;
    if (!creep.memory.deliverTarget) {
        creep.calculateDeliveryTarget();
    }
    var best = creep.memory.deliverTarget;
    if (!best) {
        return false;
    }

    if (typeof best == 'string') {
        var target = Game.getObjectById(best);
        if (!target) {
            creep.calculateDeliveryTarget();
            return true;
        }

        if (creep.pos.getRangeTo(target) > 1) {
            creep.moveTo(target);
        }
        else {
            creep.transfer(target, creep.memory.order.resourceType);
        }
        if ((target.energy && target.energy >= target.energyCapacity) || (target.store && _.sum(target.store) >= target.storeCapacity)) {
            creep.calculateDeliveryTarget();
        }
        if (!creep.carry[creep.memory.order.resourceType] || creep.carry[creep.memory.order.resourceType] <= 0) {
            creep.calculateDeliveryTarget();
        }
        return true;
    }
    else if (best.x) {
        // Dropoff location.
        if (creep.pos.x == best.x && creep.pos.y == best.y) {
            creep.drop(creep.memory.order.resourceType);
        } else {
            var result = creep.moveTo(best.x, best.y);
            //console.log(result);
            if (result == ERR_NO_PATH) {
                if (!creep.memory.blockedPathCounter) {
                    creep.memory.blockedPathCounter = 0;
                }
                creep.memory.blockedPathCounter++;

                if (creep.memory.blockedPathCounter > 10) {
                    creep.calculateDeliveryTarget();
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
        console.log('Unknown target type for delivery found!');
        console.log(creep.memory.deliverTarget);
        delete creep.memory.deliverTarget;
    }
};

/**
 * Puts this creep into or out of delivery mode.
 */
Creep.prototype.setTransporterState = function (delivering) {
    this.memory.delivering = delivering;
    delete this.memory.sourceTarget;
    delete this.memory.order;
    delete this.memory.deliverTarget;
    delete this.memory.tempRole;
};

Creep.prototype.runTransporterLogic = function () {
    if (_.sum(this.carry) >= this.carryCapacity * 0.9 && !this.memory.delivering) {
        this.setTransporterState(true);
    }
    else if (_.sum(this.carry) <= this.carryCapacity * 0.1 && this.memory.delivering) {
        this.setTransporterState(false);
    }

    if (!this.memory.delivering) {
        return this.performGetResources();
    }
    else {
        return this.performDeliver();
    }

    return true;
};
