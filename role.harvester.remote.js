// @todo When road is built, send harvester with low move _and_ carry, and let it build a container. Then, send transporters.
// @todo Collect energy if it's lying on the path.

var utilities = require('utilities');

/**
 * Makes the creep build a road under itself on its way home.
 */
Creep.prototype.performBuildRoad = function() {
    var creep = this;
    // @todo Cache this in creep memory.
    var workParts = 0;
    for (let j in creep.body) {
        if (creep.body[j].type == WORK && creep.body[j].hits > 0) {
            workParts++;
        }
    }

    if (workParts < 1) {
        return false;
    }

    // Check if creep is travelling on a road.
    var hasRoad = false;
    var actionTaken = false;
    var structures = creep.pos.lookFor(LOOK_STRUCTURES);
    if (structures && structures.length > 0) {
        for (var i in structures) {
            if (structures[i].structureType == STRUCTURE_ROAD) {
                hasRoad = true;
                break;
            }
        }
    }

    // Also repair structures in passing.
    var needsRepair = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: (structure) => (structure.structureType == STRUCTURE_ROAD || structure.structureType == STRUCTURE_CONTAINER) && structure.hits < structure.hitsMax - workParts * 100
    });
    if (needsRepair && creep.pos.getRangeTo(needsRepair) <= 3) {
        Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[creep.memory.source].buildCost += workParts;
        creep.repair(needsRepair);
        actionTaken = true;
        // If structure is especially damaged, stay here to keep repairing.
        if (needsRepair.hits < needsRepair.hitsMax - workParts * 2 * 100) {
            return true;
        }
    }

    if (!hasRoad) {
        // Make sure there is a construction site for a road on this tile.
        var constructionSites = creep.pos.lookFor(LOOK_CONSTRUCTION_SITES);
        _.filter(constructionSites, (site) => site.structureType == STRUCTURE_ROAD);
        if (constructionSites.length <= 0) {
            if (creep.pos.createConstructionSite(STRUCTURE_ROAD) != OK) {
                hasRoad = true;
            }
        }
    }

    var needsBuilding = creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES, {
        filter: (site) => site.structureType == STRUCTURE_ROAD || site.structureType == STRUCTURE_CONTAINER
    });
    if (needsBuilding && creep.pos.getRangeTo(needsBuilding) <= 3) {
        if (actionTaken) {
            // Try again next time.
            return true;
        }
        creep.build(needsBuilding);

        var buildCost = Math.min(creep.carry.energy, workParts * 5, needsBuilding.progressTotal - needsBuilding.progress);
        Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[creep.memory.source].buildCost += buildCost;
        actionTaken = true;

        // Stay here if more building is needed.
        if (needsBuilding.progressTotal - needsBuilding.progress > workParts * 10) {
            return true;
        }
    }

    if (!hasRoad) {
        return true;
    }
    return false;
};

/**
 * Makes the creep harvest resources outside of owned rooms.
 */
Creep.prototype.performRemoteHarvest = function () {
    var creep = this;
    var actionTaken = false;
    var source;
    var sourcePosition = utilities.decodePosition(creep.memory.source);
    if (sourcePosition.roomName != creep.pos.roomName) {
        creep.moveTo(sourcePosition);
        return true;
    }

    // Check if a container nearby is about to break, and repair it.
    var needsRepair = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: (structure) => (structure.structureType == STRUCTURE_CONTAINER) && structure.hits < structure.hitsMax * 0.5
    });
    if (needsRepair && creep.pos.getRangeTo(needsRepair) <= 3) {
        var workParts = 0;
        for (var j in creep.body) {
            if (creep.body[j].type == WORK && creep.body[j].hits > 0) {
                workParts++;
            }
        }

        if (creep.carry.energy >= workParts) {
            Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[creep.memory.source].buildCost += workParts;
            creep.repair(needsRepair);

            return true;
        }
    }

    var sources = creep.room.find(FIND_SOURCES, {
        filter: (source) => source.pos.x == sourcePosition.x && source.pos.y == sourcePosition.y
    });
    if (sources && sources.length > 0) {
        source = sources[0];
    }
    else {
        // @todo Send notification that source is somehow unavailable?
        creep.setRemoteHarvestState(false);
        return false;
    }

    if (source.energy <= 0 && creep.carry.energy > 0) {
        // Source is depleted, start delivering early.
        creep.setRemoteHarvestState(false);
        return false;
    }

    if (creep.pos.getRangeTo(source) > 1) {
        creep.moveTo(source);
    }
    if (actionTaken) {
        return true;
    }

    if (creep.pos.getRangeTo(source) > 1) {
        creep.moveTo(source);
    }
    else {
        creep.harvest(source);
    }
    return true;
};

/**
 * Make the creep deliver remotely harvested resources.
 */
Creep.prototype.performRemoteHarvesterDeliver = function () {
    var creep = this;
    var targetPosition = utilities.decodePosition(creep.memory.storage);
    var harvestMemory = Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[creep.memory.source];
    if (harvestMemory.hasContainer) {
        var container = Game.getObjectById(harvestMemory.containerId);
        if (!container) {
            //console.log('container no longer exists, removing...');
            harvestMemory.hasContainer = false;
            delete harvestMemory.containerId;
        }
        else {
            //console.log('container found, dropping energy.');
            if (creep.pos.getRangeTo(container) > 1) {
                creep.moveTo(container);
            }
            else {
                creep.transfer(container, RESOURCE_ENERGY);
            }

            if (_.sum(container.store) >= container.storeCapacity) {
                // Just drop energy right here, somebody will pick it up later, right?
                creep.drop(RESOURCE_ENERGY);
            }
            return true;
        }
    }

    if (targetPosition.roomName != creep.pos.roomName) {
        if (creep.performBuildRoad()) {
            return true;
        }
    }

    var target;
    if (targetPosition.roomName != creep.pos.roomName) {
        creep.moveTo(targetPosition);
        return true;
    }
    // @todo If no storage is available, use default delivery method.
    target = creep.room.storage;

    if (!target || _.sum(target.store) + creep.carry.energy >= target.storeCapacity) {
        // Container is full, drop energy instead.
        if (creep.drop(RESOURCE_ENERGY) == OK) {
            harvestMemory.revenue += creep.carry.energy;
            return true;
        }
    }


    if (creep.pos.getRangeTo(target) > 1) {
        creep.moveTo(target);
    }
    else {
        var result = creep.transfer(target, RESOURCE_ENERGY);
        if (result == OK) {
            harvestMemory.revenue += creep.carry.energy;
        }
    }

    return true;
};

/**
 * Puts this creep into or out of remote harvesting mode.
 */
Creep.prototype.setRemoteHarvestState = function (harvesting) {
    this.memory.harvesting = harvesting;

    var harvestMemory = Memory.rooms[utilities.decodePosition(this.memory.storage).roomName].remoteHarvesting[this.memory.source];
    if (harvesting) {
        roleRemoteHarvester.startTravelTimer(this);
    }
    else {
        //console.log('checking for container near source');
        // Check if there is a container near the source, and save it.
        var container = this.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: (structure) => structure.structureType == STRUCTURE_CONTAINER
        });
        if (container && this.pos.getRangeTo(container) <= 3) {
            //console.log('container found and recorded');
            harvestMemory.hasContainer = true;
            harvestMemory.containerId = container.id;
        }
        else {
            //console.log('container not found');
            harvestMemory.hasContainer = false;
            delete harvestMemory.containerId;
        }
    }
};

/**
 * Makes a creep behave like a remote harvester.
 */
Creep.prototype.runRemoteHarvesterLogic = function () {
    if (!this.memory.harvesting && this.carry.energy == 0) {
        this.setRemoteHarvestState(true);
    }
    else if (this.memory.harvesting && this.carry.energy == this.carryCapacity) {
        this.setRemoteHarvestState(false);
    }

    if (this.memory.harvesting) {
        roleRemoteHarvester.stopTravelTimer(this);
        return this.performRemoteHarvest();
    }
    else {
        return this.performRemoteHarvesterDeliver();
    }
}

// @todo Make travel timer functions reusable.
var roleRemoteHarvester = {

    startTravelTimer: function (creep) {
        if (!creep.memory.travelTimer) {
            creep.memory.travelTimer = {
                start: Game.time
            };
        }
    },

    stopTravelTimer: function (creep) {
        var harvestMemory = Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[creep.memory.source];
        if (!creep.memory.travelTimer.end) {
            // Check if we're close to our target.
            var sourcePos = utilities.decodePosition(creep.memory.source);
            if (creep.pos.roomName == sourcePos.roomName && creep.pos.getRangeTo(sourcePos) <= 3) {
                creep.memory.travelTimer.end = Game.time;
                if (!harvestMemory) {
                    harvestMemory = {};
                }
                if (!harvestMemory.travelTime) {
                    harvestMemory.travelTime = creep.memory.travelTimer.end - creep.memory.travelTimer.start;
                }
                else {
                    harvestMemory.travelTime = (harvestMemory.travelTime + creep.memory.travelTimer.end - creep.memory.travelTimer.start) / 2;
                }
            }
        }
    },

};
