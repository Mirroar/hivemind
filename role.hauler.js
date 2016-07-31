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
            if (creep.pos.getRangeTo(resource) > 1) {
                creep.moveTo(resource);
                return true;
            }
            else {
                creep.pickup(resource);
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
            filter: (creep) => creep.my && creep.memory.role == 'harvester.remote' && creep.carry.energy > 0
        });
        if (harvester && !actionTaken) {
            if (creep.pos.getRangeTo(harvester) > 1) {
                creep.moveTo(harvester);
            }
            else {
                harvester.transfer(creep, RESOURCE_ENERGY);
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
};

/**
 * Puts this creep into or out of delivery mode.
 */
Creep.prototype.setHaulerState = function (delivering) {
    this.memory.delivering = delivering;
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

    // Repair / build roads, even when just waiting for more energy.
    var targetPosition = utilities.decodePosition(this.memory.storage);
    if (targetPosition.roomName != this.pos.roomName && Game.cpu.bucket > 5000) {
        if (this.performBuildRoad()) {
            //return true;
        }
    }
    if (!this.memory.delivering) {
        return this.performGetHaulerEnergy();
    }
    else {
        return this.performHaulerDeliver();
    }
};
