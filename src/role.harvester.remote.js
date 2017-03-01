// @todo When road is built, send harvester with low move _and_ carry, and let it build a container. Then, send transporters.
// @todo Collect energy if it's lying on the path.

var utilities = require('utilities');

/**
 * Makes the creep build a road under itself on its way home.
 */
Creep.prototype.performBuildRoad = function() {
    var creep = this;
    var workParts = creep.memory.body.work;

    if (workParts < 1) {
        return false;
    }

    var hasRoad = false;
    var actionTaken = false;

    if (creep.memory.cachedPath) {
        let pos = creep.memory.cachedPath.position;
        for (let i = pos - 2; i <= pos + 2; i++) {
            if (i < 0 || i >= creep.memory.cachedPath.path.length) {
                continue;
            }

            let position = utilities.decodePosition(creep.memory.cachedPath.path[i]);
            if (position.roomName != creep.pos.roomName) {
                continue;
            }

            // Check for roads around the current path position to repair.
            let tileHasRoad = false;
            let structures = position.lookFor(LOOK_STRUCTURES);
            if (structures.length > 0) {
                for (let j in structures) {
                    if (structures[j].structureType != STRUCTURE_ROAD) {
                        continue;
                    }

                    tileHasRoad = true;

                    if (structures[j].hits < structures[j].hitsMax - workParts * 100) {
                        if (!actionTaken) {
                            Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[creep.memory.source].buildCost += workParts;
                            creep.repair(structures[j]);
                            actionTaken = true;
                            // If structure is especially damaged, stay here to keep repairing.
                            if (structures[j].hits < structures[j].hitsMax - workParts * 2 * 100) {
                                return true;
                            }
                            break;
                        }
                        else {
                            // Many repairs to do, so stay here for next tick.
                            return true;
                        }
                    }
                }
            }

            if (!tileHasRoad && _.size(Game.constructionSites) < MAX_CONSTRUCTION_SITES * 0.7) {
                let sites = position.lookFor(LOOK_CONSTRUCTION_SITES);
                let numSites = _.filter(Game.constructionSites, (site) => site.pos.roomName == position.roomName).length;
                if (sites.length < 1 && numSites < 5) {
                    if (position.createConstructionSite(STRUCTURE_ROAD) == OK) {
                        return true;
                    }
                }
            }
        }

        // Check source container and repair that, too.
        var sourcePosition = utilities.decodePosition(creep.memory.source);
        var sources = creep.room.find(FIND_SOURCES, {
            filter: (source) => source.pos.x == sourcePosition.x && source.pos.y == sourcePosition.y
        });

        if (sources.length > 0) {
            let container = sources[0].getNearbyContainer();
            if (container && this.pos.getRangeTo(container) <= 3 && container.hits < container.hitsMax - workParts * 100) {
                if (!actionTaken) {
                    Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[creep.memory.source].buildCost += workParts;
                    creep.repair(container);
                    actionTaken = true;
                    // If structure is especially damaged, stay here to keep repairing.
                    if (container.hits < container.hitsMax - workParts * 2 * 100) {
                        return true;
                    }
                }
                else {
                    // Many repairs to do, so stay here for next tick.
                    return true;
                }
            }
        }
        hasRoad = true;
    }
    else {
        // Check if creep is travelling on a road.
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

        /*if (!hasRoad) {
            // Make sure there is a construction site for a road on this tile.
            var constructionSites = creep.pos.lookFor(LOOK_CONSTRUCTION_SITES);
            _.filter(constructionSites, (site) => site.structureType == STRUCTURE_ROAD);
            if (constructionSites.length <= 0) {
                if (creep.pos.createConstructionSite(STRUCTURE_ROAD) != OK) {
                    hasRoad = true;
                }
            }
        }//*/
    }

    var needsBuilding = creep.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES, {
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

    // Check if container is built at target location.
    var sourcePosition = utilities.decodePosition(creep.memory.source);
    var sources = creep.room.find(FIND_SOURCES, {
        filter: (source) => source.pos.x == sourcePosition.x && source.pos.y == sourcePosition.y
    });

    if (sources.length > 0) {
        let container = sources[0].getNearbyContainer();

        if (!container) {
            // Check if there is a container or construction site nearby.
            var structures = sources[0].pos.findInRange(FIND_STRUCTURES, 3, {
                filter: (structure) => structure.structureType == STRUCTURE_CONTAINER
            });
            var sites = sources[0].pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 3, {
                filter: (site) => site.structureType == STRUCTURE_CONTAINER
            });
            if (structures.length == 0 && sites.length == 0) {
                // Place a container construction site for this source.
                var targetPosition = utilities.decodePosition(this.memory.storage);
                var harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[this.memory.source];

                if (harvestMemory.cachedPath) {
                    //this.setCachedPath(harvestMemory.cachedPath.path, !harvesting, 1);
                    let path = harvestMemory.cachedPath.path;
                    let containerPosition = utilities.decodePosition(path[path.length - 2]);
                    containerPosition.createConstructionSite(STRUCTURE_CONTAINER);
                }
            }
        }
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

    if (this.hasCachedPath()) {
        if (this.hasArrived() || this.pos.getRangeTo(sourcePosition) < 3) {
            this.clearCachedPath();
        }
        else {
            this.followCachedPath();
            return;
        }
    }

    if (sourcePosition.roomName != creep.pos.roomName) {
        creep.moveTo(sourcePosition);
        return true;
    }

    // Check if a container nearby is in need of repairs, since we can handle
    // it better than haulers do.
    var workParts = creep.memory.body.work;
    var needsRepair = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: (structure) => (structure.structureType == STRUCTURE_CONTAINER) && structure.hits <= structure.hitsMax - workParts * 100
    });
    if (needsRepair && creep.pos.getRangeTo(needsRepair) <= 3) {
        workParts = 0;
        for (var j in creep.body) {
            if (creep.body[j].type == WORK && creep.body[j].hits > 0) {
                workParts++;
            }
        }

        if (creep.carry.energy >= workParts && workParts > 0) {
            Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[creep.memory.source].buildCost += workParts;
            creep.repair(needsRepair);

            return true;
        }
    }

    var sources = creep.room.find(FIND_SOURCES, {
        filter: (source) => source.pos.x == sourcePosition.x && source.pos.y == sourcePosition.y
    });
    if (sources.length > 0) {
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

    // Immediately deposit energy if a container is nearby.
    var targetPosition = utilities.decodePosition(creep.memory.storage);
    var harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[creep.memory.source];
    if (harvestMemory.hasContainer) {
        var container = Game.getObjectById(harvestMemory.containerId);
        if (_.sum(creep.carry) >= creep.carryCapacity * 0.5 && creep.pos.getRangeTo(container) <= 1) {
            creep.transfer(container, RESOURCE_ENERGY);
        }
    }

    return true;
};

/**
 * Make the creep deliver remotely harvested resources.
 */
Creep.prototype.performRemoteHarvesterDeliver = function () {
    var creep = this;
    var targetPosition = utilities.decodePosition(creep.memory.storage);
    var harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[creep.memory.source];
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
        if (creep.hasCachedPath()) {
            if (creep.performBuildRoad()) {
                return true;
            }
        }
        else {
            creep.setRemoteHarvestState(true);
            return true;
        }
    }

    if (this.hasCachedPath()) {
        this.followCachedPath();
        if (this.hasArrived()) {
            this.clearCachedPath();
        }
        else {
            return;
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

    var targetPosition = utilities.decodePosition(this.memory.storage);
    var harvestMemory = Memory.rooms[targetPosition.roomName].remoteHarvesting[this.memory.source];
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

    if (!harvestMemory.cachedPath) {
        // Try precalculating the path back home if it doesn't exist yet.
        let room = Game.rooms[targetPosition.roomName];
        let sourceFlag = {pos: utilities.decodePosition(this.memory.source)};
        utilities.precalculatePaths(room, sourceFlag.pos);
    }

    if (harvestMemory.cachedPath) {
        this.setCachedPath(harvestMemory.cachedPath.path, !harvesting, 1);
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
};

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
