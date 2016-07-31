/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('structure.manager');
 * mod.thing == 'a thing'; // true
 */

 // @todo Build containers automatically at calculated dropoff spots.

var utilities = require('utilities');

var structureManager = {

    /**
     * Make sure there are roads between all major points in a room.
     */
    checkRoads: function (room) {
        // @todo Build roads around spawn, sources, controller and storage for easier access.
        console.log('---checking road structure in room', room.name);

        var controller = room.controller;
        var sources = room.find(FIND_SOURCES);
        var spawns = room.find(FIND_STRUCTURES, {
            filter: (structure) => structure.structureType == STRUCTURE_SPAWN
        });

        for (var i in spawns) {
            var spawn = spawns[i];

            structureManager.checkRoad(room, spawn.pos, controller.pos);

            for (var j in sources) {
                var source = sources[j];
                structureManager.checkRoad(room, spawn.pos, source.pos);

                var storagePosition = utilities.getStorageLocation(room);
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
