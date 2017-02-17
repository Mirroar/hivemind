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
        // @todo Move into room.prototype.
        var total = 0;
        if (room.storage) {
            total += room.storage.store[RESOURCE_ENERGY];
        }
        if (room.terminal) {
            total += room.terminal.store[RESOURCE_ENERGY];
        }

        var storageLocation = room.getStorageLocation();
        var resources = room.find(FIND_DROPPED_ENERGY, {
            filter: (resource) => resource.resourceType == RESOURCE_ENERGY && resource.pos.x == storageLocation.x && resource.pos.y == storageLocation.y
        });
        if (resources && resources.length > 0) {
            total += resources[0].amount;
        }

        return total;
    },

    clearCache: function() {
        cache = {
            harvesters: {},
            transporters: {},
        };
    }

};

module.exports = gameState;
