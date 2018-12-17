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

};

module.exports = structureManager;
