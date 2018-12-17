// @todo Build containers automatically at calculated dropoff spots.

var utilities = require('utilities');

StructureKeeperLair.prototype.isDangerous = function () {
    return !this.ticksToSpawn || this.ticksToSpawn < 20;
};

/**
 * Starts evacuation process for a room to prepare it for being abandoned.
 */
Room.prototype.setEvacuating = function (evacuate) {
    this.memory.isEvacuating = evacuate;
};

/**
 * Checks if a room is currently evacuating.
 */
Room.prototype.isEvacuating = function () {
    return this.memory.isEvacuating;
};

/**
 * Starts emptying a rooms terminal and keeps it empty.
 */
Room.prototype.setClearingTerminal = function (clear) {
    this.memory.isClearingTerminal = clear;
};

/**
 * Checks if a room's terminal should be emptied.
 */
Room.prototype.isClearingTerminal = function () {
    return this.memory.isClearingTerminal;
};

var structureManager = {

    /**
     * Determines the amount of available resources in each room.
     */
    getRoomResourceStates: function () {
        var rooms = {};
        var total = {
            resources: {},
            sources: {},
            rooms: 0,
        };

        for (let roomId in Game.rooms) {
            let room = Game.rooms[roomId];

            let storage = room.storage;
            let terminal = room.terminal;

            if (!room.controller || !room.controller.my) {
                continue;
            }

            total.rooms++;

            let roomData = {
                totalResources: {},
                state: {},
                canTrade: false,
            };
            if (storage && terminal) {
                roomData.canTrade = true;
            }

            roomData.isEvacuating = room.isEvacuating();

            if (storage && !roomData.isEvacuating) {
                for (let resourceType in storage.store) {
                    roomData.totalResources[resourceType] = storage.store[resourceType];
                    total.resources[resourceType] = (total.resources[resourceType] || 0) + storage.store[resourceType];
                }
            }
            if (terminal) {
                for (let resourceType in terminal.store) {
                    if (!roomData.totalResources[resourceType]) {
                        roomData.totalResources[resourceType] = 0;
                    }
                    roomData.totalResources[resourceType] += terminal.store[resourceType];
                    total.resources[resourceType] = (total.resources[resourceType] || 0) + terminal.store[resourceType];
                }
            }

            if (room.mineral && !roomData.isEvacuating) {
                // @todo Only count if there is an extractor on this mineral.
                roomData.mineralType = room.mineral.mineralType;
                total.sources[room.mineral.mineralType] = (total.sources[room.mineral.mineralType] || 0) + 1;
            }

            // Add resources in labs as well.
            if (room.memory.labs && !roomData.isEvacuating) {
                let ids = [];
                if (room.memory.labs.source1) {
                    ids.push(room.memory.labs.source1);
                }
                if (room.memory.labs.source2) {
                    ids.push(room.memory.labs.source2);
                }
                if (room.memory.labs.reactor) {
                    for (let i in room.memory.labs.reactor) {
                        ids.push(room.memory.labs.reactor[i]);
                    }
                }

                for (let i in ids) {
                    let lab = Game.getObjectById(ids[i]);
                    if (lab && lab.mineralType && lab.mineralAmount > 0) {
                        roomData.totalResources[lab.mineralType] = (roomData.totalResources[lab.mineralType] || 0) + lab.mineralAmount;
                        total.resources[lab.mineralType] = (total.resources[lab.mineralType] || 0) + lab.mineralAmount;
                    }
                }
            }

            for (let resourceType in roomData.totalResources) {
                let amount = roomData.totalResources[resourceType];
                if (resourceType == RESOURCE_ENERGY) {
                    amount /= 2.5;
                }

                if (amount >= 220000) {
                    roomData.state[resourceType] = 'excessive';
                }
                else if (amount >= 30000) {
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

        return {
            rooms: rooms,
            total: total,
        };
    },

    /**
     * Determines when it makes sense to transport resources between rooms.
     */
    getAvailableTransportRoutes: function (rooms) {
        var options = [];

        for (var roomName in rooms) {
            var roomState = rooms[roomName];
            if (!roomState.canTrade) continue;

            // Do not try transferring from a room that is already preparing a transfer.
            if (Game.rooms[roomName].memory.fillTerminal && !roomState.isEvacuating) continue;

            for (var resourceType in roomState.state) {
                if (roomState.state[resourceType] == 'high' || roomState.state[resourceType] == 'excessive' || roomState.isEvacuating) {
                    // Make sure we have enough to send (while evacuating).
                    if (roomState.totalResources[resourceType] < 100) continue;
                    if (resourceType == RESOURCE_ENERGY && roomState.totalResources[resourceType] < 10000) continue;

                    // Look for other rooms that are low on this resource.
                    for (var roomName2 in rooms) {
                        if (!rooms[roomName2].canTrade) continue;
                        if (rooms[roomName2].isEvacuating) continue;

                        if (roomState.isEvacuating || !rooms[roomName2].state[resourceType] || rooms[roomName2].state[resourceType] == 'low' || (roomState.state[resourceType] == 'excessive' && (rooms[roomName2].state[resourceType] == 'medium' || rooms[roomName2].state[resourceType] == 'high'))) {

                            // Make sure target has space left.
                            if (_.sum(Game.rooms[roomName2].terminal.store) > Game.rooms[roomName2].terminal.storeCapacity - 5000) {
                                continue;
                            }

                            var option = {
                                priority: 3,
                                weight: (roomState.totalResources[resourceType] - rooms[roomName2].totalResources[resourceType]) / 100000 - Game.map.getRoomLinearDistance(roomName, roomName2),
                                resourceType: resourceType,
                                source: roomName,
                                target: roomName2,
                            };

                            if (roomState.isEvacuating && resourceType != RESOURCE_ENERGY) {
                                option.priority++;
                                if (Game.rooms[roomName].terminal.store[resourceType] && Game.rooms[roomName].terminal.store[resourceType] >= 5000) {
                                    option.priority++;
                                }
                            }
                            else if (rooms[roomName2].state[resourceType] == 'medium') {
                                option.priority--;
                            }

                            //option.priority -= Game.map.getRoomLinearDistance(roomName, roomName2) * 0.5;

                            options.push(option);
                        }
                    }
                }
            }
        }

        return options;
    },

    /**
     * Sets appropriate reactions for each room depending on available resources.
     */
    chooseReactions: function (rooms) {
        for (let roomName in rooms) {
            let room = Game.rooms[roomName];
            let roomData = rooms[roomName];

            if (room && room.isEvacuating()) {
                room.memory.bestReaction = null;
                continue;
            }

            if (room && room.memory.canPerformReactions) {
                // Try to find possible reactions where we have a good amount of resources.
                var bestReaction = null;
                var mostResources = null;
                for (var resourceType in roomData.totalResources) {
                    if (roomData.totalResources[resourceType] > 0 && REACTIONS[resourceType]) {
                        for (var resourceType2 in REACTIONS[resourceType]) {
                            let targetType = REACTIONS[resourceType][resourceType2];
                            if (roomData.totalResources[targetType] > 10000) continue;

                            if (roomData.totalResources[resourceType2] && roomData.totalResources[resourceType2] > 0) {
                                //console.log(resourceType, '+', resourceType2, '=', REACTIONS[resourceType][resourceType2]);
                                var resourceAmount = Math.min(roomData.totalResources[resourceType], roomData.totalResources[resourceType2]);

                                // Also prioritize reactions whose product we don't have much of.
                                resourceAmount -= (roomData.totalResources[targetType] || 0);

                                if (!mostResources || mostResources < resourceAmount) {
                                    mostResources = resourceAmount;
                                    bestReaction = [resourceType, resourceType2];
                                }
                            }
                        }
                    }
                }

                room.memory.currentReaction = bestReaction;
                if (bestReaction) {
                    hivemind.log('labs', roomName).info('now producing', REACTIONS[bestReaction[0]][bestReaction[1]]);
                }
            }
        }
    },

    /**
     * Manages all rooms' resources.
     */
    manageResources: function () {
        let rooms = structureManager.getRoomResourceStates();
        let routes = structureManager.getAvailableTransportRoutes(rooms.rooms);
        let best = utilities.getBestOption(routes);

        if (best) {
            let room = Game.rooms[best.source];
            let terminal = room.terminal;
            let storage = room.storage;
            if (terminal.store[best.resourceType] && terminal.store[best.resourceType] > 5000) {
                let result = terminal.send(best.resourceType, 5000, best.target, "Resource equalizing");
                hivemind.log('trade').info("sending", best.resourceType, "from", best.source, "to", best.target, ":", result);
            }
            else if (room.isEvacuating() && room.storage && !room.storage[best.resourceType] && terminal.store[best.resourceType]) {
                let amount = terminal.store[best.resourceType];
                let result = terminal.send(best.resourceType, amount, best.target, "Resource equalizing");
                hivemind.log('trade').info("sending", amount, best.resourceType, "from", best.source, "to", best.target, ":", result);
            }
            else {
                hivemind.log('trade').info("Preparing 5000", best.resourceType, 'for transport from', best.source, 'to', best.target);
                room.prepareForTrading(best.resourceType);
            }
        }
        else {
            //hivemind.log('trade').info("Nothing to trade");
        }

        if (Game.time % 1500 == 981) {
            structureManager.chooseReactions(rooms.rooms);
        }
    },

};

module.exports = structureManager;
