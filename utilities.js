var intelManager = require('manager.intel');

/**
 * Calculates a central room position with some free space around it for placing a storage later.
 * If a storage already exists, its position is returned.
 */
Room.prototype.getStorageLocation = function () {
    var room = this;

    if (!this.controller) {
        return;
    }

    if (!room.memory.storage) {
        if (room.storage) {
            room.memory.storage = {
                x: room.storage.pos.x,
                y: room.storage.pos.y
            };
        }
        else {
            var sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
                filter: (site) => site.structureType == STRUCTURE_STORAGE
            });
            if (sites && sites.length > 0) {
                room.memory.storage = {
                    x: sites[0].pos.x,
                    y: sites[0].pos.y
                };
            }
            else {
                // Determine decent storage spot by averaging source and spawner locations.
                var count = 1;
                var x = room.controller.pos.x;
                var y = room.controller.pos.y;

                for (var i in room.sources) {
                    x += room.sources[i].pos.x;
                    y += room.sources[i].pos.y;
                    count++;
                }
                var spawns = room.find(FIND_STRUCTURES, {
                    filter: (structure) => structure.structureType == STRUCTURE_SPAWN
                });
                for (var i in spawns) {
                    x += spawns[i].pos.x;
                    y += spawns[i].pos.y;
                    count++;
                }

                x = Math.round(x / count);
                y = Math.round(y / count);

                // Now that we have a base position, try to find the
                // closest spot that is surrounded by empty tiles.
                var dist = 0;
                var found = false;
                while (!found && dist < 10) {
                    for (var tx = x - dist; tx <= x + dist; tx++) {
                        for (var ty = y - dist; ty <= y + dist; ty++) {
                            if (found) {
                                continue;
                            }

                            if (tx == x - dist || tx == x + dist || ty == y - dist || ty == y + dist) {
                                // Tile is only valid if it and all surrounding tiles are empty.
                                var contents = room.lookAtArea(ty - 1, tx - 1, ty + 1, tx + 1, true);
                                var clean = true;
                                for (var i in contents) {
                                    var tile = contents[i];
                                    if (tile.type == 'terrain' && tile.terrain != 'plain' && tile.terrain != 'swamp') {
                                        clean = false;
                                        break;
                                    }
                                    if (tile.type == 'structure' || tile.type == 'constructionSite') {
                                        clean = false;
                                        break;
                                    }
                                }

                                if (clean) {
                                    found = true;
                                    room.memory.storage = {
                                        x: tx,
                                        y: ty
                                    };
                                }
                            }
                        }
                    }

                    // @todo Limit dist and find "worse" free spot otherwise.
                    dist++;
                }
            }
        }
    }

    return room.memory.storage;
};

/**
 * Gathers information about a rooms sources and saves it to memory for faster access.
 */
Room.prototype.scan = function () {
    var room = this;

    //console.log('scanning', room.name);

    // Check if the controller has a container nearby.
    var structures = room.find(FIND_STRUCTURES, {
        filter: (structure) => structure.structureType == STRUCTURE_CONTAINER && structure.pos.getRangeTo(room.controller) <= 3
    });
    if (structures && structures.length > 0) {
        room.memory.controllerContainer = structures[0].id;
    }
    else {
        delete room.memory.controllerContainer;
    }

    // Check if the controller has a link nearby.
    var structures = room.find(FIND_STRUCTURES, {
        filter: (structure) => structure.structureType == STRUCTURE_LINK && structure.pos.getRangeTo(room.controller) <= 3
    });
    if (structures && structures.length > 0) {
        room.memory.controllerLink = structures[0].id;
    }
    else {
        delete room.memory.controllerLink;
    }

    // Check if storage has a link nearby.
    if (room.storage) {
        var structures = room.find(FIND_STRUCTURES, {
            filter: (structure) => structure.structureType == STRUCTURE_LINK && structure.pos.getRangeTo(room.storage) <= 3
        });
        if (structures && structures.length > 0) {
            room.memory.storageLink = structures[0].id;
        }
        else {
            delete room.memory.storageLink;
        }
    }

    // Scan room for labs.
    // @todo Find labs not used for reactions, to do creep boosts.
    if (!room.memory.labsLastChecked || room.memory.labsLastChecked < Game.time - 3267) {
        room.memory.labsLastChecked = Game.time;
        room.memory.canPerformReactions = false;

        var labs = room.find(FIND_STRUCTURES, {
            filter: (structure) => structure.structureType == STRUCTURE_LAB
        });
        if (labs.length >= 3) {
            for (let i in labs) {
                var lab = labs[i];

                // Check if there's at least 2 labs nearby for doing reactions.
                var closeLabs = lab.pos.findInRange(FIND_STRUCTURES, 2, {
                    filter: (structure) => structure.structureType == STRUCTURE_LAB && structure.id != lab.id
                });
                if (closeLabs.length < 2) continue;

                room.memory.canPerformReactions = true;
                room.memory.labs = {
                    reactor: [lab.id],
                    source1: closeLabs[0].id,
                    source2: closeLabs[1].id,
                };

                // Find other labs close to sources.
                let close2 = closeLabs[0].pos.findInRange(FIND_STRUCTURES, 2, {
                    filter: (structure) => structure.structureType == STRUCTURE_LAB && structure.id != lab.id && structure.id != closeLabs[0].id && structure.id != closeLabs[1].id
                });
                let close3 = closeLabs[1].pos.findInRange(FIND_STRUCTURES, 2, {
                    filter: (structure) => structure.structureType == STRUCTURE_LAB && structure.id != lab.id && structure.id != closeLabs[0].id && structure.id != closeLabs[1].id
                });
                for (let j in close2) {
                    for (let k in close3) {
                        if (close2[j].id == close3[k].id) {
                            room.memory.labs.reactor.push(close2[j].id);
                            break;
                        }
                    }
                }

                break;
            }
        }
    }
};

var utilities = {

    precalculatePaths: function (room, sourceFlag) {
        if (Game.pathPrecalculated) return;

        var start = Game.cpu.getUsed();
        //console.log('precalculate harvest paths', room, sourceFlag);

        var flagPosition = utilities.encodePosition(sourceFlag.pos);

        if (!room.memory.remoteHarvesting) {
            room.memory.remoteHarvesting = {};
        }
        if (!room.memory.remoteHarvesting[flagPosition]) {
            room.memory.remoteHarvesting[flagPosition] = {};
        }
        var harvestMemory = room.memory.remoteHarvesting[flagPosition];

        if (harvestMemory.cachedPath && Game.time - harvestMemory.cachedPath.lastCalculated < 4060) {
            // No need to recalculate path.
            return;
        }

        var startPosition = room.getStorageLocation();
        startPosition = new RoomPosition(startPosition.x, startPosition.y, room.name);
        if (room.storage) {
            startPosition = room.storage.pos;
        }

        var endPosition = sourceFlag.pos;
        //console.log('Finding path between', startPosition, 'and', endPosition);

        var result = utilities.getPath(startPosition, {pos: endPosition, range: 1});
        Game.pathPrecalculated = true;

        if (result) {
            //console.log('found path in', result.ops, 'operations', result.path);
            console.log('[PathFinder] New path calculated.');

            harvestMemory.cachedPath = {
                lastCalculated: Game.time,
                path: Room.serializePositionPath(result.path),
            };
        }
        else {
            console.log('No path found!');
        }

        var end = Game.cpu.getUsed();
        //console.log('Total time:', end - start);
    },

    getPath: function (startPosition, endPosition, allowDanger) {
        return PathFinder.search(startPosition, endPosition, {
            plainCost: 2,
            swampCost: 10,
            maxOps: 10000, // The default 2000 can be too little even at a distance of only 2 rooms.

            roomCallback: function (roomName) {
                let room = Game.rooms[roomName];

                // If a room is considered inaccessible, don't look for paths through it.
                if (!allowDanger && intelManager.isRoomInaccessible(roomName)) return false;

                // If we have no sight in a room, assume it is empty.
                if (!room) return new PathFinder.CostMatrix;

                // Work with roads and structures in a room.
                // @todo Let intel manager generate the CostMatrixes and reuse them here.
                let costs = new PathFinder.CostMatrix;

                room.find(FIND_STRUCTURES).forEach(function (structure) {
                    if (structure.structureType === STRUCTURE_ROAD) {
                        // Only do this if no structure is on the road.
                        if (costs.get(structure.pos.x, structure.pos.y) <= 0) {
                            // Favor roads over plain tiles.
                            costs.set(structure.pos.x, structure.pos.y, 1);
                        }
                    } else if (structure.structureType !== STRUCTURE_CONTAINER && (structure.structureType !== STRUCTURE_RAMPART || !structure.my)) {
                        // Can't walk through non-walkable buildings.
                        costs.set(structure.pos.x, structure.pos.y, 0xff);
                    }
                });

                // Also try not to drive through bays.
                room.find(FIND_FLAGS, {
                    filter: (flag) => flag.name.startsWith('Bay:')
                }).forEach(function (flag) {
                    if (costs.get(flag.pos.x, flag.pos.y) <= 20) {
                        costs.set(flag.pos.x, flag.pos.y, 20);
                    }
                });

                // @todo Try not to drive to close to sources / minerals / controllers.

                return costs;
            },
        });
    },

    getClosest: function (creep, targets) {
        if (targets.length > 0) {
            var target = creep.pos.findClosestByRange(targets);
            if (target) {
                return target.id;
            }
        }
        return null;
    },

    getBestOption: function (options) {
        var best = null;

        for (var i in options) {
            if (!best || options[i].priority > best.priority || (options[i].priority == best.priority && options[i].weight > best.weight)) {
                best = options[i];
            }
        }

        return best;
    },

    getBodyCost: function (creep) {
        var cost = 0;
        for (var i in creep.body) {
            cost += BODYPART_COST[creep.body[i].type];
        }

        return cost;
    },

    getBodyParts: function (creep) {
        return creep.memory.body;
    },

    generateCreepBody: function (weights, maxCost, maxParts) {
        var newParts = {};
        var size = 0;
        var cost = 0;

        if (!maxCost) {
            maxCost = 300;
        }

        // Generate initial body containing at least one of each part.
        for (var part in weights) {
            newParts[part] = 1;
            size++;
            cost += BODYPART_COST[part];
        }

        if (cost > maxCost) {
            return null;
        }

        var done = false;
        while (!done && size < 50) {
            done = true;
            for (var part in BODYPART_COST) {
                var currentWeight = newParts[part] / size;
                if (currentWeight <= weights[part] && cost + BODYPART_COST[part] <= maxCost) {
                    if (!maxParts || !maxParts[part] || newParts[part] < maxParts[part]) {
                        done = false;
                        newParts[part]++;
                        size++;
                        cost += BODYPART_COST[part];
                        if (size >= 50) {
                            break;
                        }
                    }
                    else {
                        // Limit for this bodypart has been reached, so stop adding.
                        done = true;
                        break;
                    }
                }
            }
        }

        //console.log('total cost of new body: ' + cost);

        // Chain the generated configuration into an array of body parts.
        var body = [];

        if (newParts.tough) {
            for (var i = 0; i < newParts.tough; i++) {
                body.push(TOUGH);
            }
            delete newParts.tough;
        }
        if (newParts.move) {
            // One move part will be added last.
            newParts.move--;
        }
        var done = false;
        while (!done) {
            done = true;
            for (var part in newParts) {
                if (newParts[part] > 0) {
                    body.push(part);
                    newParts[part]--;
                    done = false;
                }
            }
        }
        if (newParts.move !== undefined) {
            // Add last move part to make sure creep is always mobile.
            body.push(MOVE);
        }

        return body;
    },

    encodePosition: function (position) {
        return position.roomName + '@' + position.x + 'x' + position.y;
    },

    decodePosition: function (position) {
        var parts = position.match(/^(.*)@([0-9]*)x([0-9]*)$/);

        if (parts && parts.length > 0) {
            return new RoomPosition(parts[2], parts[3], parts[1]);
        }
        return null;
    }

};

module.exports = utilities;
