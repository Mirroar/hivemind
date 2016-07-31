/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('role.harvester');
 * mod.thing == 'a thing'; // true
 */

// @todo Assign close-by container to dump resources.
// @todo Assign harvesters to a specific resource spot and balance numbers accordingly.

var gameState = require('game.state');
var utilities = require('utilities');

var roleRemoteHarvester = {

    buildRoad: function(creep) {
        var structures = creep.pos.lookFor(LOOK_STRUCTURES);
        if (structures && structures.length > 0) {
            for (var i in structures) {
                if (structures[i].structureType == STRUCTURE_ROAD) {
                    var workParts = 0;
                    for (var j in creep.body) {
                        if (creep.body[j].type == WORK && creep.body[j].hits > 0) {
                            workParts++;
                        }
                    }

                    if (structures[i].hits < structures[i].hitsMax - workParts * 100) {
                        Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[utilities.decodePosition(creep.memory.source).roomName].buildCost += workParts;
                        creep.repair(structures[i]);
                        // If road is especially damaged, stay here to keep repairing.
                        if (structures[i].hits < structures[i].hitsMax - workParts * 2 * 100) {
                            return true;
                        }
                    }
                    return false;
                }
            }
        }

        var constructionSites = creep.pos.lookFor(LOOK_CONSTRUCTION_SITES);
        if (constructionSites && constructionSites.length > 0) {
            if (constructionSites[0].structureType == STRUCTURE_ROAD) {
                creep.build(constructionSites[0]);
                var workParts = 0;
                for (var i in creep.body) {
                    if (creep.body[i].type == WORK && creep.body[i].hits > 0) {
                        workParts++;
                    }
                }

                var buildCost = Math.min(creep.carry.energy, workParts * 5, constructionSites[0].progressTotal - constructionSites[0].progress);
                Memory.rooms[utilities.decodePosition(creep.memory.storage).roomName].remoteHarvesting[utilities.decodePosition(creep.memory.source).roomName].buildCost += buildCost;
                return true;
            }
        }
        else {
            if (creep.pos.createConstructionSite(STRUCTURE_ROAD) == OK) {
                return true;
            }
        }
        return false;
    },

    harvest: function (creep) {
        var source;
        var sourcePosition = utilities.decodePosition(creep.memory.source);
        if (sourcePosition.roomName != creep.pos.roomName) {
            creep.moveTo(sourcePosition);
            return true;
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

        var result = creep.harvest(source);
        if (result == ERR_NOT_IN_RANGE || result == ERR_NOT_ENOUGH_RESOURCES) {
            var result = creep.moveTo(source);
        }
        return true;
    },

    deliver: function (creep) {
        if (roleRemoteHarvester.buildRoad(creep)) {
            return true;
        }

        var target;
        var targetPosition = utilities.decodePosition(creep.memory.storage);
        if (targetPosition.roomName != creep.pos.roomName) {
            creep.moveTo(targetPosition);
            return true;
        }
        // @todo If no storage is available, use default delivery method.
        target = creep.room.storage;

        if (_.sum(target.store) + creep.carry.energy >= target.storeCapacity) {
            // Container is full, drop energy instead.
            if (creep.drop(RESOURCE_ENERGY) == OK) {
                creep.room.memory.remoteHarvesting[utilities.decodePosition(creep.memory.source).roomName].revenue += creep.carry.energy;
                return true;
            }
        }

        var result = creep.transfer(target, RESOURCE_ENERGY);
        if (result == OK) {
            creep.room.memory.remoteHarvesting[utilities.decodePosition(creep.memory.source).roomName].revenue += creep.carry.energy;
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

    spawn: function (spawner, targetPosition) {
        if ((spawner.room.energyAvailable >= spawner.room.energyCapacityAvailable * 0.9) && !spawner.spawning) {
            var body = utilities.generateCreepBody({move: 0.5, work: 0.2, carry: 0.3}, spawner.room.energyAvailable);

            // Use less move parts if a road has already been established.
            if (spawner.room.memory.remoteHarvesting && spawner.room.memory.remoteHarvesting[targetPosition.roomName] && spawner.room.memory.remoteHarvesting[targetPosition.roomName].revenue > 0) {
                body = utilities.generateCreepBody({move: 0.35, work: 0.25, carry: 0.4}, spawner.room.energyAvailable);
            }

            if (spawner.canCreateCreep(body) == OK) {
                var newName = spawner.createCreep(body, undefined, {
                    role: 'harvester.remote',
                    storage: utilities.encodePosition(spawner.room.storage.pos),
                    source: utilities.encodePosition(targetPosition)
                });
                console.log('Spawning new remote harvester: ' + newName);

                // Save some stats.
                if (!spawner.room.memory.remoteHarvesting) {
                    spawner.room.memory.remoteHarvesting = {};
                }
                if (!spawner.room.memory.remoteHarvesting[targetPosition.roomName]) {
                    spawner.room.memory.remoteHarvesting[targetPosition.roomName] = {
                        creepCost: 0,
                        buildCost: 0,
                        revenue: 0,
                        harvesters: [],
                    };
                }

                var cost = 0;
                for (var i in body) {
                    cost += BODYPART_COST[body[i]];
                }

                spawner.room.memory.remoteHarvesting[targetPosition.roomName].creepCost += cost;

                return true;
            }
        }
        return false;
    }
};

module.exports = roleRemoteHarvester;
