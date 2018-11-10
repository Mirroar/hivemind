var creepGeneral = require('creep.general');
var utilities = require('utilities');

/**
 * Determines the best place to store resources.
 */
Room.prototype.getBestStorageTarget = function (amount, resourceType) {
    if (this.storage && this.terminal) {
        let storageFree = this.storage.storeCapacity - _.sum(this.storage.store);
        let terminalFree = this.terminal.storeCapacity - _.sum(this.terminal.store);
        if (this.isEvacuating() && terminalFree > this.terminal.storeCapacity * 0.2) {
            // If we're evacuating, store everything in terminal to be sent away.
            return this.terminal;
        }
        if (this.isClearingTerminal() && storageFree > this.storage.storeCapacity * 0.2) {
            // If we're clearing out the terminal, put everything into storage.
            return this.storage;
        }

        if (!resourceType) {
            if (_.sum(this.storage.store) / this.storage.storeCapacity < _.sum(this.terminal.store) / this.terminal.storeCapacity) {
                return this.storage;
            }
            return this.terminal;
        }

        if (storageFree >= amount && terminalFree >= amount && (this.storage.store[resourceType] || 0) / storageFree < (this.terminal.store[resourceType] || 0) / terminalFree) {
            return this.storage;
        }
        if (terminalFree >= amount) {
            return this.terminal;
        }
        else if (storageFree >= amount) {
            return this.storage;
        }
    }
    else if (this.storage) {
        return this.storage;
    }
    else if (this.terminal) {
        return this.terminal;
    }
};

/**
 * Determines the best place to get resources from.
 */
Room.prototype.getBestStorageSource = function (resourceType) {
    if (this.storage && this.terminal) {
        if (this.isEvacuating()) {
            // Take resources out of storage if possible to empty it out.
            if (this.storage.store[resourceType] && (_.sum(this.terminal.store) < this.terminal.storeCapacity * 0.8 || !this.terminal.store[resourceType])) {
                return this.storage;
            }
            else if (this.terminal.store[resourceType] && (resourceType == RESOURCE_ENERGY || _.sum(this.terminal.store) > this.terminal.storeCapacity * 0.8)) {
                return this.terminal;
            }
            return;
        }
        if (this.isClearingTerminal()) {
            // Take resources out of terminal if possible to empty it out.
            if (this.terminal.store[resourceType] && (_.sum(this.storage.store) < this.storage.storeCapacity * 0.8 || !this.storage.store[resourceType])) {
                return this.terminal;
            }
            else if (this.storage.store[resourceType] && (resourceType == RESOURCE_ENERGY || _.sum(this.storage.store) > this.storage.storeCapacity * 0.8)) {
                return this.storage;
            }
            return;
        }
        else if ((this.storage.store[resourceType] || 0) / this.storage.storeCapacity < (this.terminal.store[resourceType]) / this.terminal.storeCapacity) {
            if (this.memory.fillTerminal != resourceType) {
                return this.terminal;
            }
        }
        if ((this.storage.store[resourceType] || 0) > 0) {
            return this.storage;
        }
    }
    else if (this.storage && this.storage.store[resourceType]) {
        return this.storage;
    }
    else if (this.terminal && this.terminal.store[resourceType] && this.memory.fillTerminal != resourceType) {
        return this.terminal;
    }
};

/**
 * Creates a priority list of energy sources available to this creep.
 */
Creep.prototype.getAvailableEnergySources = function () {
    var creep = this;
    var storage = this.room.storage;
    var terminal = this.room.terminal;
    var options = [];

    var storagePriority = 0;
    if (creep.room.energyAvailable < creep.room.energyCapacityAvailable * 0.9) {
        // Spawning is important, so get energy when needed.
        storagePriority = 4;
    }
    else if (creep.room.terminal && creep.room.storage && creep.room.terminal.store.energy < creep.room.storage.store.energy * 0.05) {
        // Take some energy out of storage to put into terminal from time to time.
        storagePriority = 2;
    }

    // Energy can be gotten at the room's storage or terminal.
    let storageTarget = creep.room.getBestStorageSource(RESOURCE_ENERGY);
    if (storageTarget && storageTarget.store.energy >= creep.carryCapacity - _.sum(creep.carry)) {
        // Only transporters can get the last bit of energy from storage, so spawning can always go on.
        if (creep.memory.role == 'transporter' || storageTarget.store.energy > 5000 || !creep.room.storage || storageTarget.id != creep.room.storage.id) {
            options.push({
                priority: creep.memory.role == 'transporter' ? storagePriority : 5,
                weight: 0,
                type: 'structure',
                object: storageTarget,
                resourceType: RESOURCE_ENERGY,
            });
        }
    }

    // Get storage location, since that is a low priority source for transporters.
    var storagePosition = creep.room.getStorageLocation();

    // Look for energy on the ground.
    var targets = creep.room.find(FIND_DROPPED_RESOURCES, {
        filter: (resource) => {
            if (resource.resourceType == RESOURCE_ENERGY) {
                if (creep.pos.findPathTo(resource)) return true;
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
                option.priority = storagePriority;
            }
            else {
                option.priority = 5;
            }
        }
        else {
            if (target.amount < 100) {
                option.priority--;
            }
            if (target.amount < 200) {
                option.priority--;
            }
            option.priority -= creepGeneral.getCreepsWithOrder('getEnergy', target.id, creep.room).length * 3;
        }

        if (creep.room.getStorageCapacity() < target.amount) {
            // If storage is super full, try leaving stuff on the ground.
            option.priority -= 2;
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

        // Don't use the controller container as a normal source.
        if (target.id == target.room.memory.controllerContainer) {
            continue;
        }

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
                    option.priority = 2;
                    if (_.sum(target.store) >= creep.carryCapacity - _.sum(creep.carry)) {
                        // This container is filling up, prioritize emptying it.
                        option.priority += 2;
                    }
                    break;
                }
            }
        }

        option.priority -= creepGeneral.getCreepsWithOrder('getEnergy', target.id, creep.room).length * 3;

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
    let storage = creep.room.storage;
    if (terminal && (_.sum(terminal.store) > terminal.storeCapacity * 0.8 || creep.room.isClearingTerminal()) && !creep.room.isEvacuating()) {
        // Find resource with highest count and take that.
        // @todo Unless it's supposed to be sent somewhere else.
        let max = null;
        let maxResourceType = null;
        for (let resourceType in terminal.store) {
            if (resourceType == RESOURCE_ENERGY && storage.store[RESOURCE_ENERGY] > terminal.store[RESOURCE_ENERGY] * 5) {
                // Do not take out energy if there is enough in storage.
                continue;
            }

            if (!max || terminal.store[resourceType] > max) {
                max = terminal.store[resourceType];
                maxResourceType = resourceType;
            }
        }

        let option = {
            priority: 1,
            weight: 0,
            type: 'structure',
            object: terminal,
            resourceType: maxResourceType,
        };

        if (creep.room.isClearingTerminal()) {
            option.priority = 3;
        }

        options.push(option);
    }

    // @todo Take resources from storage if terminal is relatively empty.

    // Take resources from storage to terminal for transfer if requested.
    if (creep.room.memory.fillTerminal && !creep.room.isClearingTerminal()) {
        let resourceType = creep.room.memory.fillTerminal;
        if (storage && terminal && storage.store[resourceType]) {
            if ((storage.store[resourceType] > this.carryCapacity || creep.room.isEvacuating()) && _.sum(terminal.store) < terminal.storeCapacity - 10000) {
                options.push({
                    priority: 4,
                    weight: 0,
                    type: 'structure',
                    object: storage,
                    resourceType: resourceType,
                });
            }
        }
        else {
            // No more of these resources can be taken into terminal.
            delete creep.room.memory.fillTerminal;
        }
    }

    // Look for resources on the ground.
    var targets = creep.room.find(FIND_DROPPED_RESOURCES, {
        filter: (resource) => {
            if (resource.amount > 10 && creep.pos.findPathTo(resource)) {
                return true;
            }
            return false;
        }
    });

    for (var i in targets) {
        var target = targets[i];
        var option = {
            priority: 4,
            weight: target.amount / 30, // @todo Also factor in distance.
            type: 'resource',
            object: target,
            resourceType: target.resourceType,
        };

        if (target.resourceType == RESOURCE_POWER) {
            option.priority++;
        }

        if (creep.room.getStorageCapacity() < target.amount) {
            // If storage is super full, try leaving stuff on the ground.
            option.priority -= 2;
        }

        options.push(option);
    }

    // Take non-energy out of containers.
    if (terminal || storage) {
        let containers = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => structure.structureType == STRUCTURE_CONTAINER
        });

        for (let i in containers) {
            for (let resourceType in containers[i].store) {
                if (resourceType != RESOURCE_ENERGY && containers[i].store[resourceType] > 0) {
                    var option = {
                        priority: 3,
                        weight: containers[i].store[resourceType] / 20, // @todo Also factor in distance.
                        type: 'structure',
                        object: containers[i],
                        resourceType: resourceType,
                    };

                    options.push(option);
                }
            }
        }
    }

    // Take ghodium if nuker needs it.
    if (creep.room.nuker && creep.room.nuker.ghodium < creep.room.nuker.ghodiumCapacity) {
        var target = creep.room.getBestStorageSource(RESOURCE_GHODIUM);
        if (target && target.store[RESOURCE_GHODIUM] > 0) {
            var option = {
                priority: 2,
                weight: 0, // @todo Also factor in distance.
                type: 'structure',
                object: target,
                resourceType: RESOURCE_GHODIUM,
            };

            options.push(option);
        }
    }

    // Take power if power spawn needs it.
    if (creep.room.powerSpawn && creep.room.powerSpawn.power < creep.room.powerSpawn.powerCapacity * 0.1) {
        var target = creep.room.getBestStorageSource(RESOURCE_POWER);
        if (target && target.store.power > 0) {
            // @todo Limit amount since power spawn can only hold 100 power at a time.
            // @todo Make sure only 1 creep does this at a time.
            var option = {
                priority: 3,
                weight: 0, // @todo Also factor in distance.
                type: 'structure',
                object: target,
                resourceType: RESOURCE_POWER,
            };

            if (creep.room.isFullOnPower()) {
                option.priority++;
            }

            options.push(option);
        }
    }

    if (creep.room.isEvacuating()) {
        // Take everything out of labs.
        let labs = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => structure.structureType == STRUCTURE_LAB
        });

        for (let i in labs) {
            let lab = labs[i];
            if (lab.energy > 0) {
                options.push({
                    priority: 4,
                    weight: 0,
                    type: 'structure',
                    object: lab,
                    resourceType: RESOURCE_ENERGY,
                });
            }

            if (lab.mineralType) {
                options.push({
                    priority: 4,
                    weight: 0,
                    type: 'structure',
                    object: lab,
                    resourceType: lab.mineralType,
                });
            }
        }

        // Also take everything out of storage.
        if (storage && terminal && _.sum(terminal.store) < terminal.storeCapacity * 0.8) {
            for (let resourceType in storage.store) {
                if (storage.store[resourceType] <= 0) continue;

                options.push({
                    priority: 3,
                    weight: 0,
                    type: 'structure',
                    object: storage,
                    resourceType: resourceType,
                });

                break;
            }
        }
    }

    if (creep.room.memory.canPerformReactions && !creep.room.isEvacuating()) {
        let labs = creep.room.memory.labs.reactor;
        if (typeof labs == 'string') {
            labs = [labs];
            creep.room.memory.labs.reactor = labs;
        }

        for (let i in labs) {
            // Clear out reaction labs.
            let lab = Game.getObjectById(labs[i]);

            if (lab && lab.mineralAmount > 0) {
                let option = {
                    priority: 0,
                    weight: lab.mineralAmount / lab.mineralCapacity,
                    type: 'structure',
                    object: lab,
                    resourceType: lab.mineralType,
                };

                if (lab.mineralAmount > lab.mineralCapacity * 0.3) {
                    option.priority++;
                }
                if (lab.mineralAmount > lab.mineralCapacity * 0.6) {
                    option.priority++;
                }
                if (lab.mineralAmount > lab.mineralCapacity * 0.9) {
                    option.priority++;
                }

                if (creep.room.memory.currentReaction) {
                    // If we're doing a different reaction now, clean out faster!
                    if (REACTIONS[creep.room.memory.currentReaction[0]][creep.room.memory.currentReaction[1]] != lab.mineralType) {
                        option.priority = 4;
                        option.weight = 0;
                    }
                }

                options.push(option);
            }
        }

        // Clear out labs with wrong resources.
        lab = Game.getObjectById(creep.room.memory.labs.source1);
        if (lab && lab.mineralAmount > 0 && creep.room.memory.currentReaction && lab.mineralType != creep.room.memory.currentReaction[0]) {
            let option = {
                priority: 3,
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
                priority: 3,
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
                var source = terminal;
                if (!terminal || !terminal.store[creep.room.memory.currentReaction[0]] || terminal.store[creep.room.memory.currentReaction[0]] <= 0) {
                    source = creep.room.storage;
                }
                let option = {
                    priority: 3,
                    weight: 1 - lab.mineralAmount / lab.mineralCapacity,
                    type: 'structure',
                    object: source,
                    resourceType: creep.room.memory.currentReaction[0],
                };

                if (lab.mineralAmount > lab.mineralCapacity * 0.2) {
                    option.priority--;
                }

                options.push(option);
            }
            lab = Game.getObjectById(creep.room.memory.labs.source2);
            if (lab && (!lab.mineralType || lab.mineralType == creep.room.memory.currentReaction[1]) && lab.mineralAmount < lab.mineralCapacity * 0.5) {
                var source = terminal;
                if (!terminal || !terminal.store[creep.room.memory.currentReaction[1]] || terminal.store[creep.room.memory.currentReaction[1]] <= 0) {
                    source = creep.room.storage;
                }
                let option = {
                    priority: 3,
                    weight: 1 - lab.mineralAmount / lab.mineralCapacity,
                    type: 'structure',
                    object: source,
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

    if (best && best.object) {
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
            creep.moveToRange(target, 1);
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
            creep.moveToRange(target, 1);
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
    if (!target || (target.store && _.sum(target.store) <= 0) || (target.amount && target.amount <= 0)) {
        creep.calculateSource();
    }
    else if (creep.memory.order.resourceType != RESOURCE_ENERGY && target.mineralAmount && (target.mineralAmount <= 0 || target.mineralType != creep.memory.order.resourceType)) {
        creep.calculateSource();
    }
    else if (target.store && (!target.store[creep.memory.order.resourceType] || target.store[creep.memory.order.resourceType] <= 0)) {
        creep.calculateSource();
    }
    else if (target.energyCapacity && target.energy <= 0 && creep.memory.order.resourceType == RESOURCE_ENERGY) {
        creep.calculateSource();
    }
    else if (target.store) {
        if (creep.pos.getRangeTo(target) > 1) {
            creep.moveToRange(target, 1);
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
            creep.moveToRange(target, 1);
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
            creep.moveToRange(target, 1);
        }
        else {
            let result = creep.withdraw(target, creep.memory.order.resourceType);
            if (result == OK) {
                creep.calculateSource();
            }
        }
    }
    else if (target.energyCapacity && creep.memory.order.resourceType == RESOURCE_ENERGY) {
        if (creep.pos.getRangeTo(target) > 1) {
            creep.moveToRange(target, 1);
        }
        else {
            let result = creep.withdraw(target, creep.memory.order.resourceType);
            if (result == OK) {
                creep.calculateSource();
            }
        }
    }
    else if (target.mineralCapacity) {
        // Empty lab.
        creep.calculateSource();
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
                return ((structure.structureType == STRUCTURE_EXTENSION && !structure.isBayExtension()) ||
                        structure.structureType == STRUCTURE_SPAWN) && structure.energy < structure.energyCapacity;
            }
        });

        for (let i in targets) {
            let target = targets[i];

            let canDeliver = Math.min(creep.carry.energy, target.energyCapacity - target.energy);

            let option = {
                priority: 5,
                weight: canDeliver / creep.carryCapacity,
                type: 'structure',
                object: target,
                resourceType: RESOURCE_ENERGY,
            };

            option.weight += 1 - (creep.pos.getRangeTo(target) / 100);
            option.priority -= creepGeneral.getCreepsWithOrder('deliver', target.id, creep.room).length * 3;

            options.push(option);
        }

        // Fill bays.
        for (let i in creep.room.bays) {
            let target = creep.room.bays[i];

            if (target.energy >= target.energyCapacity) continue;

            let canDeliver = Math.min(creep.carry.energy, target.energyCapacity - target.energy);

            let option = {
                priority: 5,
                weight: canDeliver / creep.carryCapacity,
                type: 'bay',
                object: target,
                resourceType: RESOURCE_ENERGY,
            };

            option.weight += 1 - (creep.pos.getRangeTo(target) / 100);
            option.priority -= creepGeneral.getCreepsWithOrder('deliver', target.name, creep.room).length * 3;

            options.push(option);
        }

        // Fill containers.
        var targets = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                if (structure.structureType == STRUCTURE_CONTAINER && structure.store.energy < structure.storeCapacity) {
                    // Do deliver to controller containers, always.
                    if (structure.id == structure.room.memory.controllerContainer) {
                        return true;
                    }

                    // Do not deliver to containers used as harvester drop off points.
                    if (structure.room.sources) {
                        for (let id in structure.room.sources) {
                            let container = structure.room.sources[id].getNearbyContainer();
                            if (container && container.id == structure.id) {
                                return false;
                            }
                        }
                        if (structure.room.mineral) {
                            let container = structure.room.mineral.getNearbyContainer();
                            if (container && container.id == structure.id) {
                                return false;
                            }
                        }
                    }
                    return true;
                }
                return false;
            }
        });

        for (let i in targets) {
            let target = targets[i];
            let option = {
                priority: 4,
                weight: (target.storeCapacity - target.store[RESOURCE_ENERGY]) / 100, // @todo Also factor in distance, and other resources.
                type: 'structure',
                object: target,
                resourceType: RESOURCE_ENERGY,
            };

            let prioFactor = 1;
            if (target.store[RESOURCE_ENERGY] / target.storeCapacity > 0.5) {
                prioFactor = 2;
            }
            else if (target.store[RESOURCE_ENERGY] / target.storeCapacity > 0.75) {
                prioFactor = 3;
            }

            option.priority -= creepGeneral.getCreepsWithOrder('deliver', target.id, creep.room).length * prioFactor;

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

            if (creep.room.memory.enemies && !creep.room.memory.enemies.safe) {
                option.priority++;
            }
            if (target.energy < target.energyCapacity * 0.2) {
                option.priority++;
            }

            option.priority -= creepGeneral.getCreepsWithOrder('deliver', target.id, creep.room).length * 2;

            options.push(option);
        }

        if (!creep.room.isEvacuating()) {
            // Supply nukers and power spawns with energy.
            var targets = creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => {
                    return (structure.structureType == STRUCTURE_NUKER || structure.structureType == STRUCTURE_POWER_SPAWN) && structure.energy < structure.energyCapacity;
                }
            });

            for (var i in targets) {
                var target = targets[i];
                var option = {
                    priority: 1,
                    weight: (target.energyCapacity - target.energy) / 100, // @todo Also factor in distance.
                    type: 'structure',
                    object: target,
                    resourceType: RESOURCE_ENERGY,
                };

                if (target.structureType == STRUCTURE_POWER_SPAWN) {
                    option.priority += 2;
                }

                option.priority -= creepGeneral.getCreepsWithOrder('deliver', target.id, creep.room).length * 2;

                options.push(option);
            }
        }

        // Put in storage if nowhere else needs it.
        let storageTarget = creep.room.getBestStorageTarget(this.carry.energy, RESOURCE_ENERGY);
        if (storageTarget) {
            options.push({
                priority: 0,
                weight: 0,
                type: 'structure',
                object: storageTarget,
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
                let option = {
                    priority: 5,
                    weight: (target.energyCapacity - target.energy) / 100, // @todo Also factor in distance.
                    type: 'structure',
                    object: target,
                    resourceType: RESOURCE_ENERGY,
                };

                if (creep.pos.getRangeTo(target) > 3) {
                    // Don't go out of your way to fill the link, do it when energy is taken out of storage.
                    option.priority = 4;
                }

                options.push(option);
            }
        }
    }

    for (let resourceType in creep.carry) {
        // If it's needed for transferring, store in terminal.
        if (resourceType == creep.room.memory.fillTerminal && creep.carry[resourceType] > 0 && !creep.room.isClearingTerminal()) {
            if (terminal && (!terminal.store[resourceType] || terminal.store[resourceType] < (creep.room.memory.fillTerminalAmount || 10000)) && _.sum(terminal.store) < terminal.storeCapacity) {
                var option = {
                    priority: 4,
                    weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
                    type: 'structure',
                    object: terminal,
                    resourceType: resourceType,
                };
                options.push(option);
            }
            else {
                creep.room.stopTradePreparation();
            }
        }

        // The following only only concerns resources other than energy.
        if (resourceType == RESOURCE_ENERGY || creep.carry[resourceType] <= 0) {
            continue;
        }

        let storageTarget = creep.room.getBestStorageTarget(creep.carry[resourceType], resourceType);

        // If there is space left, store in storage.
        if (storageTarget && _.sum(storageTarget.store) < storageTarget.storeCapacity) {
            options.push({
                priority: 1,
                weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
                type: 'structure',
                object: storageTarget,
                resourceType: resourceType,
            });
        }

        // Put ghodium in nukers.
        if (resourceType == RESOURCE_GHODIUM && !creep.room.isEvacuating()) {
            var targets = creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => {
                    return (structure.structureType == STRUCTURE_NUKER) && structure.ghodium < structure.ghodiumCapacity;
                }
            });

            for (var i in targets) {
                options.push({
                    priority: 2,
                    weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
                    type: 'structure',
                    object: targets[i],
                    resourceType: resourceType,
                });
            }
        }

        // Put power in power spawns.
        if (resourceType == RESOURCE_POWER && creep.room.powerSpawn && !creep.room.isEvacuating()) {
            if (creep.room.powerSpawn.power < creep.room.powerSpawn.powerCapacity * 0.1) {
                options.push({
                    priority: 4,
                    weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
                    type: 'structure',
                    object: creep.room.powerSpawn,
                    resourceType: resourceType,
                });
            }
        }

        // Put correct resources into labs.
        if (creep.room.memory.currentReaction && !creep.room.isEvacuating()) {
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

        // As a last resort, simply drop the resource since it can't be put anywhere.
        options.push({
            priority: 0,
            weight: 0,
            type: 'drop',
            resourceType: resourceType,
        });
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
            creep.memory.deliverTarget = {x: best.object.x, y: best.object.y, type: best.type};

            creep.memory.order = {
                type: 'deliver',
                target: utilities.encodePosition(best.object),
                resourceType: best.resourceType,
            };
        }
        else if (best.type == 'bay') {
            creep.memory.deliverTarget = {x: best.object.pos.x, y: best.object.pos.y, type: best.type},

            creep.memory.order = {
                type: 'deliver',
                target: best.object.name,
                resourceType: best.resourceType,
            };
        }
        else if (best.type == 'drop') {
            creep.drop(best.resourceType, creep.carry[best.resourceType]);
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
        if (!creep.carry[creep.memory.order.resourceType] || creep.carry[creep.memory.order.resourceType] <= 0) {
            creep.calculateDeliveryTarget();
        }

        if (creep.pos.getRangeTo(target) > 1) {
            creep.moveToRange(target, 1);
        }
        else {
            creep.transfer(target, creep.memory.order.resourceType);
        }

        if ((creep.memory.order.resourceType == RESOURCE_ENERGY && target.energy && target.energy >= target.energyCapacity) || (target.store && _.sum(target.store) >= target.storeCapacity) || (target.mineralAmount && target.mineralAmount >= target.mineralCapacity)) {
            creep.calculateDeliveryTarget();
        }
        else if (creep.memory.order.resourceType == RESOURCE_POWER && target.power && target.power >= target.powerCapacity) {
            creep.calculateDeliveryTarget();
        }

        else if (target.mineralAmount && target.mineralType != creep.memory.order.resourceType) {
            creep.calculateDeliveryTarget();
        }
        return true;
    }
    else if (best.type == 'bay') {
        let target = creep.room.bays[creep.memory.order.target];
        if (!target) {
            creep.calculateDeliveryTarget();
            return true;
        }

        if (creep.pos.getRangeTo(target) > 0) {
            creep.moveToRange(target);
        }
        else {
            target.refillFrom(creep);
        }
        if (target.energy >= target.energyCapacity) {
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
        }
        else {
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

Creep.prototype.bayUnstuck = function () {
    //return false;

    // If the creep is in a bay, but not delivering to that bay (any more), make it move out of the bay forcibly.
    for (let i in this.room.bays) {
        let bay = this.room.bays[i];
        if (bay.extensions.length < 7) continue;

        if (this.pos.x != bay.pos.x || this.pos.y != bay.pos.y) continue;

        let best = this.memory.deliverTarget;

        if (best && typeof best != 'string' && best.type == 'bay' && this.memory.order.target == i) continue;


        // We're standing in a bay that we're not delivering to.
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx == 0 && dy == 0) continue;

                if (Game.map.getTerrainAt(this.pos.x + dx, this.pos.y + dy, this.pos.roomName) == 'wall') continue;

                let pos = new RoomPosition(this.pos.x + dx, this.pos.y + dy, this.pos.roomName);
                let blocked = false;

                // Check if there's a structure here already.
                let structures = pos.lookFor(LOOK_STRUCTURES);
                for (let i in structures) {
                    if (structures[i].structureType != STRUCTURE_ROAD && structures[i].structureType != STRUCTURE_CONTAINER && structures[i].structureType != STRUCTURE_RAMPART) {
                        blocked = true;
                        break;
                    }
                }
                if (blocked) continue;

                // Check if there's a construction site here already.
                let sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
                for (let i in sites) {
                    if (sites[i].structureType != STRUCTURE_ROAD && sites[i].structureType != STRUCTURE_CONTAINER && sites[i].structureType != STRUCTURE_RAMPART) {
                        blocked = true;
                        break;
                    }
                }
                if (blocked) continue;

                let dir = this.pos.getDirectionTo(pos);
                this.move(dir);

                //console.log(this.name, dir);

                return true;
            }
        }
    }

    return false;
}

Creep.prototype.runTransporterLogic = function () {
    if (this.memory.singleRoom && this.pos.roomName != this.memory.singleRoom) {
        this.moveToRange(new RoomPosition(25, 25, this.memory.singleRoom), 10);
        return;
    }

    if (_.sum(this.carry) >= this.carryCapacity * 0.9 && !this.memory.delivering) {
        this.setTransporterState(true);
    }
    else if (_.sum(this.carry) <= this.carryCapacity * 0.1 && this.memory.delivering) {
        this.setTransporterState(false);
    }

    if (this.bayUnstuck()) {
        return true;
    }

    if (!this.memory.delivering) {
        // Make sure not to keep standing on resource drop stop.
        var storagePosition = this.room.getStorageLocation();
        if (!this.room.storage && storagePosition && this.pos.x == storagePosition.x && this.pos.y == storagePosition.y && (!this.memory.order || !this.memory.order.target)) {
            this.move(_.random(1, 8));
            return true;
        }

        return this.performGetResources();
    }
    else {
        return this.performDeliver();
    }

    return true;
};
