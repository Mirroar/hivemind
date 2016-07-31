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

var roleRemoteHarvester = {

    buildRoad: function(creep) {
        // @todo Cache this in creep memory.
        var workParts = 0;
        for (var j in creep.body) {
            if (creep.body[j].type == WORK && creep.body[j].hits > 0) {
                workParts++;
            }
        }

        if (workParts <= 1) {
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
            Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[utilities.decodePosition(creep.memory.source).roomName].buildCost += workParts;
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
            Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[utilities.decodePosition(creep.memory.source).roomName].buildCost += buildCost;
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
    },

    harvest: function (creep) {
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
                Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[utilities.decodePosition(creep.memory.source).roomName].buildCost += workParts;
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
            roleRemoteHarvester.setHarvesting(creep, false);
            return false;
        }

        if (source.energy <= 0 && creep.carry.energy > 0) {
            // Source is depleted, start delivering early.
            roleRemoteHarvester.setHarvesting(creep, false);
        }

        if (creep.pos.getRangeTo(source) > 1) {
            creep.moveTo(source);
        }
        if (actionTaken) {
            return true;
        }
        var result = creep.harvest(source);
        if (result == ERR_NOT_IN_RANGE || result == ERR_NOT_ENOUGH_RESOURCES) {
            creep.moveTo(source);
        }
        return true;
    },

    deliver: function (creep) {
        var sourcePos = utilities.decodePosition(creep.memory.source);
        var harvestMemory = Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[sourcePos.roomName];
        if (harvestMemory[creep.memory.source] && harvestMemory[creep.memory.source].hasContainer) {
            var container = Game.getObjectById(harvestMemory[creep.memory.source].containerId);
            if (!container) {
                //console.log('container no longer exists, removing...');
                harvestMemory[creep.memory.source].hasContainer = false;
                delete harvestMemory[creep.memory.source].containerId;
            }
            else {
                //console.log('container found, dropping energy.');
                if (creep.transfer(container, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(container);
                }
                if (_.sum(container.store) >= container.storeCapacity) {
                    // Just drop energy right here, somebody will pick it up later, right?
                    creep.drop(RESOURCE_ENERGY);
                }
                return true;
            }
        }

        if (sourcePos.roomName == creep.pos.roomName) {
            if (roleRemoteHarvester.buildRoad(creep)) {
                return true;
            }
        }

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
            if (creep.drop(RESOURCE_ENERGY) == OK) {
                harvestMemory.revenue += creep.carry.energy;
                return true;
            }
        }

        var result = creep.transfer(target, RESOURCE_ENERGY);
        if (result == OK) {
            harvestMemory.revenue += creep.carry.energy;
        }
        else if (result == ERR_NOT_IN_RANGE) {
            creep.moveTo(target);
        }

        return true;
    },

    setHarvesting: function (creep, harvesting) {
        creep.memory.harvesting = harvesting;

        var harvestMemory = Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[utilities.decodePosition(creep.memory.source).roomName];
        if (harvesting && !creep.memory.travelTimer) {
            creep.memory.travelTimer = {
                start: Game.time
            };
        }
        else if (!harvesting && creep.memory.travelTimer && !creep.memory.travelTimer.end) {
            creep.memory.travelTimer.end = Game.time;
            if (!harvestMemory[creep.memory.source]) {
                harvestMemory[creep.memory.source] = {};
            }
            if (!harvestMemory[creep.memory.source].travelTime) {
                harvestMemory[creep.memory.source].travelTime = creep.memory.travelTimer.end - creep.memory.travelTimer.start;
            }
            else {
                harvestMemory[creep.memory.source].travelTime = (harvestMemory[creep.memory.source].travelTime + creep.memory.travelTimer.end - creep.memory.travelTimer.start) / 2;
            }
        }

        if (!harvesting) {
            //console.log('checking for container near source');
            // Check if there is a container near the source, and save it.
            var container = creep.pos.findClosestByRange(FIND_STRUCTURES, {
                filter: (structure) => structure.structureType == STRUCTURE_CONTAINER
            });
            if (container && creep.pos.getRangeTo(container) <= 3) {
                //console.log('container found and recorded');
                harvestMemory[creep.memory.source].hasContainer = true;
                harvestMemory[creep.memory.source].containerId = container.id;
            }
            else {
                //console.log('container not found');
                harvestMemory[creep.memory.source].hasContainer = false;
                delete harvestMemory[creep.memory.source].containerId;
            }
        }
    },

    /** @param {Creep} creep **/
    run: function (creep) {
        if (!creep.memory.harvesting && creep.carry.energy == 0) {
            roleRemoteHarvester.setHarvesting(creep, true);
        }
        else if (creep.memory.harvesting && creep.carry.energy == creep.carryCapacity) {
            roleRemoteHarvester.setHarvesting(creep, false);
        }

        if (creep.memory.harvesting) {
            return roleRemoteHarvester.harvest(creep);
        }
        else {
            return roleRemoteHarvester.deliver(creep);
        }
    },

};

module.exports = roleRemoteHarvester;
