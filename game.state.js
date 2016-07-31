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

        var storageLocation = utilities.getStorageLocation(room);
        var resources = room.find(FIND_DROPPED_ENERGY, {
            filter: (resource) => resource.resourceType == RESOURCE_ENERGY && resource.pos.x == storageLocation.x && resource.pos.y == storageLocation.y
        });
        if (resources && resources.length > 0) {
            return resources[0].amount;
        }

        return 0;
    },

    getNumHarvesters: function () {
        return gameState.getHarvesters().length;
    },

    getHarvesters: function () {
        if (!cache.harvesters) {
            cache.harvesters = _.filter(Game.creeps, (creep) => creep.memory.role == 'harvester');
        }
        return cache.harvesters;
    },

    getNumTransporters: function () {
        return gameState.getTransporters().length;
    },

    getTransporters: function () {
        if (!cache.transporters) {
            cache.transporters = _.filter(Game.creeps, (creep) => creep.memory.role == 'transporter');
        }
        return cache.transporters;
    },
    
    clearCache: function() {
        cache = {};
    }

};

module.exports = gameState;
