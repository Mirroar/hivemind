// @todo When road is built, send harvester with low move _and_ carry, and let it build a container. Then, send transporters.
// @todo Record time it takes to get to source, so a new harvester can be built in time.
// @todo Collect energy if it's lying on the path.

var utilities = require('utilities');

/**
 * Makes a creep get energy from different rooms.
 */
Creep.prototype.performGetHaulerEnergy = function () {
    var creep = this;
    var source;
    var actionTaken = false;
    if (creep.memory.source) {
        var sourcePosition = utilities.decodePosition(creep.memory.source);
        var targetPosition = utilities.decodePosition(creep.memory.storage);
        var harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[creep.memory.source];

        if (this.hasCachedPath()) {
            this.followCachedPath();
            if (this.hasArrived()) {
                this.clearCachedPath();
            }
            else {
                if (this.pos.getRangeTo(sourcePosition) <= 3) {
                    this.clearCachedPath();
                }
                else {
                    return;
                }
            }
        }
        else if (this.pos.getRangeTo(sourcePosition) > 10) {
            // This creep _should_ be on a cached path!
            // It probably just spawned.
            //console.log(this.name, '@', utilities.encodePosition(this.pos), 'is not on a cached path when it should be, resetting!');
            this.setHaulerState(false);
            return;
        }

        if (sourcePosition.roomName != creep.pos.roomName) {
            creep.moveTo(sourcePosition);
            return true;
        }

        // Check if energy is on the ground nearby and pick that up.
        var resource;
        if (creep.memory.energyPickupTarget) {
            resource = Game.getObjectById(creep.memory.energyPickupTarget);

            if (!resource) {
                delete creep.memory.energyPickupTarget;
            }
            else if (resource.pos.roomName != creep.pos.roomName) {
                resource = null;
                delete creep.memory.energyPickupTarget;
            }
        }
        if (!resource) {
            let resources = creep.pos.findInRange(FIND_DROPPED_ENERGY, 3, {
                filter: (resource) => resource.resourceType == RESOURCE_ENERGY
            });
            if (resources.length > 0) {
                resource = resources[0];
                creep.memory.energyPickupTarget = resource.id;
            }
        }
        if (resource) {
            if (creep.pos.getRangeTo(resource) > 1) {
                creep.moveTo(resource);
                return true;
            }
            else {
                creep.pickup(resource);
            }
            actionTaken = true;
        }

        // Get energy from target container.
        if (harvestMemory.hasContainer) {
            var container = Game.getObjectById(harvestMemory.containerId);

            if (container) {
                if (actionTaken) {
                    creep.moveTo(container);
                    return true;
                }
                else if (creep.pos.getRangeTo(container) > 1) {
                    creep.moveTo(container);
                }
                else {
                    creep.withdraw(container, RESOURCE_ENERGY);
                }
                actionTaken = true;
            }
        }

        // Also lighten the load of harvesters nearby.
        var harvester = sourcePosition.findClosestByRange(FIND_CREEPS, {
            filter: (creep) => creep.my && creep.memory.role == 'harvester.remote' && creep.carry.energy > creep.carryCapacity * 0.5 && this.pos.getRangeTo(creep) <= 3
        });
        if (harvester && !actionTaken) {
            if (creep.pos.getRangeTo(harvester) > 1) {
                creep.moveTo(harvester);
            }
            else {
                harvester.transfer(creep, RESOURCE_ENERGY);
            }
        }

        // If all else fails, make sure we're close enough to our source.
        if (this.pos.getRangeTo(sourcePosition) > 2) {
            this.moveTo(sourcePosition);
        }

        // Repair / build roads, even when just waiting for more energy.
        var targetPosition = utilities.decodePosition(this.memory.storage);
        if (!actionTaken && targetPosition.roomName != this.pos.roomName && Game.cpu.bucket > 3000) {
            if (this.performBuildRoad()) {
                return true;
            }
        }
    }
    else if (creep.memory.sourceContainer) {
        // @todo?
    }

    return true;
};

/**
 * Makes a creep deliver resources to another room.
 */
Creep.prototype.performHaulerDeliver = function () {
    var creep = this;
    var sourcePos = utilities.decodePosition(creep.memory.source);
    var target;
    var targetPosition = utilities.decodePosition(creep.memory.storage);
    var harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[creep.memory.source];

    if (this.hasCachedPath()) {
        this.followCachedPath();
        if (this.hasArrived()) {
            this.clearCachedPath();
        }
        else {
            if (this.pos.getRangeTo(targetPosition) <= 3) {
                this.clearCachedPath();
            }
            else {
                return;
            }
        }
    }

    if (targetPosition.roomName != creep.pos.roomName) {
        creep.moveTo(targetPosition);

        return true;
    }
    // @todo If no storage is available, use default delivery method.
    target = creep.room.getBestStorageTarget(creep.carry.energy, RESOURCE_ENERGY);
    if (!target || _.sum(target.store) + creep.carry.energy >= target.storeCapacity) {
        // Container is full, drop energy instead.
        let storageLocation = creep.room.getStorageLocation();
        if (storageLocation) {
            if (creep.pos.x != storageLocation.x || creep.pos.y != storageLocation.y) {
                let result = creep.moveTo(storageLocation.x, storageLocation.y);
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
};

/**
 * Puts this creep into or out of delivery mode.
 */
Creep.prototype.setHaulerState = function (delivering) {
    this.memory.delivering = delivering;

    if (this.memory.source) {
        var sourcePosition = utilities.decodePosition(this.memory.source);
        var targetPosition = utilities.decodePosition(this.memory.storage);
        var harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[this.memory.source];

        if (harvestMemory.cachedPath) {
            this.setCachedPath(harvestMemory.cachedPath.path, delivering, 1);
        }
    }
};

/**
 * Makes a creep behave like a hauler.
 */
Creep.prototype.runHaulerLogic = function () {
    if (this.memory.delivering && this.carry.energy == 0) {
        this.setHaulerState(false);
    }
    else if (!this.memory.delivering && _.sum(this.carry) >= this.carryCapacity * 0.9) {
        this.setHaulerState(true);
    }

    if (!this.memory.delivering) {
        return this.performGetHaulerEnergy();
    }
    else {
        // Repair / build roads on the way home.
        var targetPosition = utilities.decodePosition(this.memory.storage);
        if (targetPosition.roomName != this.pos.roomName && Game.cpu.bucket > 3000) {
            if (this.performBuildRoad()) {
                //return true;
            }
        }
        return this.performHaulerDeliver();
    }
};
