 // @todo Build containers automatically at calculated dropoff spots.

var utilities = require('utilities');

StructureTower.prototype.runLogic = function() {
    var tower = this;

    // Emergency repairs.
    var closestDamagedStructure = tower.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: (structure) => {
            if (structure.structureType == STRUCTURE_WALL) {
                return ((structure.pos.getRangeTo(tower) <= 5 && structure.hits < 10000) || structure.hits < 1000) && tower.energy > tower.energyCapacity * 0.7;
            }
            if (structure.structureType == STRUCTURE_RAMPART) {
                return ((structure.pos.getRangeTo(tower) <= 5 && structure.hits < 10000) || structure.hits < 1000) && tower.energy > tower.energyCapacity * 0.7 || structure.hits < 500;
            }
            return (structure.hits < structure.hitsMax - TOWER_POWER_REPAIR) && (structure.hits < structure.hitsMax * 0.2);
        }
    });
    if (closestDamagedStructure) {
        tower.repair(closestDamagedStructure);
    }

    // Attack enemies.
    var closestHostileHealer = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
        filter: (creep) => {
            for (var i in creep.body) {
                if (creep.body[i].type == HEAL && creep.body[i].hits > 0) {
                    return true;
                }
            }
            return false;
        }
    });
    var closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
    if (closestHostileHealer) {
        tower.attack(closestHostileHealer);
    }
    else if (closestHostile) {
        tower.attack(closestHostile);
    }

    // Heal friendlies.
    var damaged = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
        filter: (creep) => creep.hits < creep.hitsMax
    });
    if (damaged) {
        tower.heal(damaged);
    }
};

var structureManager = {

    getRoomResourceStates: function () {
        var rooms = {};

        for (let roomId in Game.rooms) {
            let room = Game.rooms[roomId];

            let storage = room.storage;
            let terminal = room.terminal;

            if (!room.controller || !room.controller.my || !terminal || !storage) {
                continue;
            }

            let roomData = {
                totalResources: {},
                state: {},
            };

            for (let resourceType in storage.store) {
                roomData.totalResources[resourceType] = storage.store[resourceType];
            }
            for (let resourceType in terminal.store) {
                if (!roomData.totalResources[resourceType]) {
                    roomData.totalResources[resourceType] = 0;
                }
                roomData.totalResources[resourceType] += terminal.store[resourceType];
            }

            for (let resourceType in roomData.totalResources) {
                let amount = roomData.totalResources[resourceType];
                if (resourceType == RESOURCE_ENERGY) {
                    amount /= 3;
                }

                if (amount >= 100000) {
                    roomData.state[resourceType] = 'high';
                }
                else if (amount >= 10000) {
                    roomData.state[resourceType] = 'medium';
                }
                else {
                    roomData.state[resourceType] = 'low';
                }
            }

            rooms[room.name] = roomData;
        }

        return rooms;
    },

    getAvailableTransportRoutes: function () {
        var options = [];
        var rooms = structureManager.getRoomResourceStates();

        for (var roomName in rooms) {
            var roomState = rooms[roomName];
            for (var resourceType in roomState.state) {
                if (roomState.state[resourceType] == 'high') {
                    // Look for other rooms that are low on this resource.
                    for (var roomName2 in rooms) {
                        if (!rooms[roomName2].state[resourceType] || rooms[roomName2].state[resourceType] == 'low') {
                            // Make sure target has space left.
                            if (_.sum(Game.rooms[roomName2].terminal.store) > Game.rooms[roomName2].terminal.storeCapacity - 5000) {
                                continue;
                            }

                            var option = {
                                priority: 5,
                                weight: 0,
                                resourceType: resourceType,
                                source: roomName,
                                target: roomName2,
                            };

                            option.priority -= Game.map.getRoomLinearDistance(roomName, roomName2) * 0.5;

                            if (option.priority < 0) {
                                continue;
                            }

                            options.push(option);
                        }
                    }
                }
            }
        }

        return options;
    },

    manageResources: function () {
        var best = utilities.getBestOption(structureManager.getAvailableTransportRoutes());

        if (best) {
            var terminal = Game.rooms[best.source].terminal;
            var result = terminal.send(best.resourceType, 5000, best.target, "Resource equalizing");
            console.log("sending", best.resourceType, "from", best.source, "to", best.target, ":", result);
        }
    },

    /**
     * Make sure there are roads between all major points in a room.
     */
    checkRoads: function (room) {
        if (!room.controller || !room.controller.my) {
            return;
        }

        // @todo Build roads around spawn, sources, controller and storage for easier access.
        console.log('---checking road structure in room', room.name);

        var controller = room.controller;
        var spawns = room.find(FIND_STRUCTURES, {
            filter: (structure) => structure.structureType == STRUCTURE_SPAWN
        });

        for (var i in spawns) {
            var spawn = spawns[i];

            structureManager.checkRoad(room, spawn.pos, controller.pos);

            for (var j in room.sources) {
                var source = room.sources[j];
                structureManager.checkRoad(room, spawn.pos, source.pos);

                var storagePosition = room.getStorageLocation();
                if (storagePosition) {
                    var sPos = room.getPositionAt(storagePosition.x, storagePosition.y);
                    structureManager.checkRoad(room, spawn.pos, sPos);
                    structureManager.checkRoad(room, source.pos, sPos);
                }
            }
        }
    },

    /**
     * Verify path between two positions and (re-)build roads accordingly.
     */
    checkRoad: function (room, source, target) {
        var path = source.findPathTo(target, {
            ignoreCreeps: true
        });

        for (var i in path) {
            var tile = path[i];

            var contents = room.lookAt(tile.x, tile.y);
            var buildRoad = true;
            for (var j in contents) {
                var content = contents[j];
                if (content.type == 'terrain') {
                    if (content.terrain != 'plain' && content.terrain != 'swamp') {
                        //console.log('invalid terrain:', content.terrain);
                        buildRoad = false;
                        break;
                    }
                }
                if (content.type == 'structure') {
                    if (content.structure.structureType != STRUCTURE_CONTAINER && content.structure.structureType != STRUCTURE_RAMPART) {
                        buildRoad = false;
                        break;
                    }
                }
                if (content.type == 'constructionSite') {
                    if (content.constructionSite.structureType != STRUCTURE_CONTAINER && content.constructionSite.structureType != STRUCTURE_RAMPART) {
                        buildRoad = false;
                        break;
                    }
                }
            }
            if (buildRoad) {
                room.createConstructionSite(tile.x, tile.y, STRUCTURE_ROAD);
            }
        }
    }

};

module.exports = structureManager;
