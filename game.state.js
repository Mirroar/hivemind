/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('game.state');
 * mod.thing == 'a thing'; // true
 */

var utilities = require('utilities');

var cache = {};

var gameState = {

    getStoredEnergy: function (room) {
        if (room.storage) {
            return room.storage.store[RESOURCE_ENERGY];
        }

        var storageLocation = room.getStorageLocation();
        var resources = room.find(FIND_DROPPED_ENERGY, {
            filter: (resource) => resource.resourceType == RESOURCE_ENERGY && resource.pos.x == storageLocation.x && resource.pos.y == storageLocation.y
        });
        if (resources && resources.length > 0) {
            return resources[0].amount;
        }

        return 0;
    },

    getNumHarvesters: function (roomName) {
        return gameState.getHarvesters(roomName).length;
    },

    getHarvesters: function (roomName) {
        if (!cache.harvesters[roomName]) {
            cache.harvesters[roomName] = _.filter(Game.creeps, (creep) => creep.memory.role == 'harvester' && (!roomName || creep.pos.roomName == roomName));
        }
        return cache.harvesters[roomName];
    },

    getNumTransporters: function (roomName) {
        return gameState.getTransporters(roomName).length;
    },

    getTransporters: function (roomName) {
        if (!cache.transporters[roomName]) {
            cache.transporters[roomName] = _.filter(Game.creeps, (creep) => creep.memory.role == 'transporter' && (!roomName || creep.pos.roomName == roomName));
        }
        return cache.transporters[roomName];
    },

    clearCache: function() {
        cache = {
            harvesters: {},
            transporters: {},
        };
    }

};

module.exports = gameState;
