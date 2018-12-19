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
            let roomData = room.getResourceState();
            if (!roomData) continue;

            total.rooms++;
            for (let resourceType in roomData.totalResources) {
                total.resources[resourceType] = (total.resources[resourceType] || 0) + roomData.totalResources[resourceType];
            }
            total.sources[roomData.mineralType] = (total.sources[roomData.mineralType] || 0) + 1;
            rooms[room.name] = roomData;
        }

        return {
            rooms: rooms,
            total: total,
        };
    },

};

module.exports = structureManager;
