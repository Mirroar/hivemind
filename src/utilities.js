var intelManager = require('manager.intel');

Room.prototype.getCostMatrix = function () {
    return utilities.getCostMatrix(this.name);
};

/**
 * Calculates a central room position with some free space around it for placing a storage later.
 * If a storage already exists, its position is returned.
 */
Room.prototype.getStorageLocation = function () {
    var room = this;

    if (!this.controller) {
        return;
    }

    if (this.roomPlanner && this.roomPlanner.memory.locations && this.roomPlanner.memory.locations.center) {
        for (let pos in this.roomPlanner.memory.locations.center) {
            return utilities.decodePosition(pos);
        }
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
            // Find best 2 source labs for other labs to perform reactions.
            let best = null;
            for (let i in labs) {
                var lab = labs[i];

                var closeLabs = lab.pos.findInRange(FIND_STRUCTURES, 2, {
                    filter: (structure) => structure.structureType == STRUCTURE_LAB && structure.id != lab.id
                });
                if (closeLabs.length < 2) continue;

                for (let j in closeLabs) {
                    lab2 = closeLabs[j];

                    let reactors = [];
                    for (let k in closeLabs) {
                        let reactor = closeLabs[k];
                        if (reactor == lab || reactor == lab2) continue;
                        if (reactor.pos.getRangeTo(lab2) > 2) continue;

                        reactors.push(reactor.id);
                    }

                    if (reactors.length == 0) continue;
                    if (!best || best.reactor.length < reactors.length) {
                        best = {
                            source1: lab.id,
                            source2: lab2.id,
                            reactor: reactors,
                        };
                    }
                }
            }

            if (best) {
                room.memory.canPerformReactions = true;
                room.memory.labs = best;
            }
        }
    }
};

var utilities = {

    /**
     * Dynamically determines the username of the current user.
     */
    getUsername: function () {
        for (var i in Game.spawns) {
            return Game.spawns[i].owner.username;
        }
    },

    precalculatePaths: function (room, sourcePos) {
        if (Game.cpu.getUsed() > Game.cpu.tickLimit * 0.5) return;

        var start = Game.cpu.getUsed();
        //console.log('precalculate harvest paths', room, sourcePos);

        var flagPosition = utilities.encodePosition(sourcePos);

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

        var endPosition = sourcePos;
        //console.log('Finding path between', startPosition, 'and', endPosition);

        var result = utilities.getPath(startPosition, {pos: endPosition, range: 1});

        if (result) {
            //console.log('found path in', result.ops, 'operations', result.path);
            new Game.logger('pathfinder').debug('New path calculated from', startPosition, 'to', endPosition);

            harvestMemory.cachedPath = {
                lastCalculated: Game.time,
                path: utilities.serializePositionPath(result.path),
            };
        }
        else {
            console.log('No path found!');
        }

        var end = Game.cpu.getUsed();
        //console.log('Total time:', end - start);
    },

    getPath: function (startPosition, endPosition, allowDanger, addOptions) {
        let options = {
            plainCost: 2,
            swampCost: 10,
            maxOps: 10000, // The default 2000 can be too little even at a distance of only 2 rooms.

            roomCallback: function (roomName) {
                let room = Game.rooms[roomName];

                // If a room is considered inaccessible, don't look for paths through it.
                if (!allowDanger && intelManager.isRoomInaccessible(roomName)) {
                    if (!addOptions || !addOptions.whiteListRooms || addOptions.whiteListRooms.indexOf(roomName) == -1) {
                        return false;
                    }
                }

                // Work with roads and structures in a room.
                let options = {};
                if (addOptions && addOptions.singleRoom && addOptions.singleRoom == roomName) {
                    options.singleRoom = true;
                }

                let costs = utilities.getCostMatrix(roomName, options);

                // Also try not to drive through bays.
                _.filter(Game.flags, (flag) => {
                    return flag.pos.roomName == roomName && flag.name.startsWith('Bay:')
                }).forEach(function (flag) {
                    if (costs.get(flag.pos.x, flag.pos.y) <= 20) {
                        costs.set(flag.pos.x, flag.pos.y, 20);
                    }
                });

                // @todo Try not to drive too close to sources / minerals / controllers.

                return costs;
            },
        };

        if (addOptions) {
            for (let key in addOptions) {
                options[key] = addOptions[key];
            }
        }

        return PathFinder.search(startPosition, endPosition, options);
    },

    costMatrixCache: {},

    getCostMatrix: function (roomName, options) {
        if (!options) {
            options = {};
        }

        let cacheKey = roomName;
        let matrix;
        if (!utilities.costMatrixCache[cacheKey]) {
            if (Memory.rooms[roomName] && Memory.rooms[roomName].intel && Memory.rooms[roomName].intel.costMatrix) {
                matrix = PathFinder.CostMatrix.deserialize(Memory.rooms[roomName].intel.costMatrix);
            }
            else if (Game.rooms[roomName]) {
                matrix = Game.rooms[roomName].generateCostMatrix();
            }
            else {
                matrix = new PathFinder.CostMatrix();
            }

            utilities.costMatrixCache[cacheKey] = matrix;
        }
        matrix = utilities.costMatrixCache[cacheKey];

        if (matrix && options.singleRoom) {
            // Highly discourage room exits if creep is supposed to stay in a room.
            cacheKey += ':singleRoom';

            if (!utilities.costMatrixCache[cacheKey]) {
                matrix = matrix.clone();
                for (let x = 0; x < 50; x++) {
                    for (let y = 0; y < 50; y++) {
                        if (x == 0 || y == 0 || x == 49 || y == 49) {
                            let terrain = Game.map.getTerrainAt(x, y, roomName);
                            if (terrain != 'wall') {
                                matrix.set(x, y, 50);
                            }
                        }
                    }
                }
                utilities.costMatrixCache[cacheKey] = matrix;
            }
        }
        matrix = utilities.costMatrixCache[cacheKey];

        return matrix;
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

        // Chain the generated configuration into an array of body parts.
        var body = [];

        if (newParts.tough) {
            for (var i = 0; i < newParts.tough; i++) {
                body.push(TOUGH);
            }
            delete newParts.tough;
        }
        var done = false;
        while (!done) {
            done = true;
            for (var part in newParts) {
                if (part == ATTACK || part == RANGED_ATTACK || part == HEAL) continue;
                if (newParts[part] > 0) {
                    body.push(part);
                    newParts[part]--;
                    done = false;
                }
            }
        }

        // Add military parts last to keep fighting effeciency.
        var lastParts = [RANGED_ATTACK, ATTACK, HEAL];
        for (var p in lastParts) {
            var part = lastParts[p];
            for (var i = 0; i < newParts[part] || 0; i++) {
                body.push(part);
            }
        }

        return body;
    },

    /**
     * Serializes a position for storing it in memory.
     */
    encodePosition: function (position) {
        if (!position) return;

        return position.roomName + '@' + position.x + 'x' + position.y;
    },

    /**
     * Creates a RoomPosition object from serialized data.
     */
    decodePosition: function (position) {
        if (!position) return;

        var parts = position.match(/^(.*)@([0-9]*)x([0-9]*)$/);

        if (parts && parts.length > 0) {
            return new RoomPosition(parts[2], parts[3], parts[1]);
        }
        return null;
    },

    /**
     * Serializes an array of RoomPosition objects for storing in memory.
     */
    serializePositionPath: function (path) {
        var result = [];
        for (var i in path) {
            result.push(utilities.encodePosition(path[i]));
        }

        return result;
    },

    /**
     * Deserializes a serialized path into an array of RoomPosition objects.
     */
    deserializePositionPath: function (path) {
        var result = [];
        for (var i in path) {
            result.push(utilities.decodePosition(path[i]));
        }

        return result;
    },

    /**
     * Generates a Van der Corput sequence for the given number of digits and base.
     */
    generateEvenSequence: function (numDigits, base) {
        let numbers = [];
        let digits = [];
        for (let i = 0; i < numDigits; i++) {
            digits[i] = 0;
        }

        function increase(digit) {
            if (digit >= numDigits) return;

            digits[digit]++;
            if (digits[digit] >= base) {
                digits[digit] = 0;
                increase(digit + 1);
            }
        }

        function getNumber() {
            let sum = 0;
            for (let i = 0; i < numDigits; i++) {
                sum *= base;
                sum += digits[i];
            }
            return sum;
        }

        increase(0);
        let number = getNumber();
        let max = number * base;
        numbers.push(max);
        while (number != 0) {
            numbers.push(number);
            increase(0);
            number = getNumber();
        }

        return numbers;
    },

    /**
     * Choose whether a calculation should currently be executed based on priorities.
     */
    throttle: function (offset, minBucket, maxBucket) {
        utilities.initThrottleMemory();

        if (!offset) offset = 0;
        if (!minBucket) minBucket = Memory.throttleInfo.bucket.critical;
        if (!maxBucket) maxBucket = Memory.throttleInfo.bucket.normal;

        var bucket = Game.cpu.bucket;
        if (bucket > maxBucket) return false;
        if (bucket < minBucket) return true;

        var tick = (Game.time + offset) % Memory.throttleInfo.max;
        var ratio = (bucket - minBucket) / (maxBucket - minBucket);

        if (ratio >= Memory.throttleInfo.numbers[tick]) return false;

        return true;
    },

    getThrottleOffset: function () {
        utilities.initThrottleMemory();

        if (!Memory.throttleInfo.currentOffset) {
            Memory.throttleInfo.currentOffset = 0;
        }
        Memory.throttleInfo.currentOffset++;
        return Memory.throttleInfo.currentOffset;
    },

    initThrottleMemory: function () {
        if (!Memory.throttleInfo) {
            Memory.throttleInfo = {
                bucket: {
                    normal: 8000,
                    warning: 5000,
                    critical: 2000,
                },
            };
        }
        if (!Memory.throttleInfo.numbers) {
            Memory.throttleInfo.numbers = [];

            let sequence = utilities.generateEvenSequence(8, 2);
            let max = sequence[0];
            Memory.throttleInfo.max = max;
            let distribution = [];

            for (let i in sequence) {
                Memory.throttleInfo.numbers[sequence[i]] = 1 - (i / max);
            }
            Memory.throttleInfo.numbers[0] = 1;
        }
    },

    generateCPUStats: function () {
        /*//
        Memory.stats['cpu.CreepManagers'] = spawnCPUUsage;
        Memory.stats['cpu.Towers'] = towersCPUUsage;
        Memory.stats['cpu.Creeps'] = creepsCPUUsage;
        Memory.stats['cpu.Start'] = initCPUUsage;
        Memory.stats['cpu.stats'] = Game.cpu.getUsed() - totalTime;
        Memory.stats['cpu.getUsed'] = Game.cpu.getUsed();
        //*/

        let limit = Game.cpu.limit;

        let output = '';

        function formatStat(amount, label) {
            var percent = 100 * amount / limit;
            return '[' + label + ':' + ('    ' + Math.round(percent)).slice(-4) + '%]';
        }
        output += formatStat(Memory.stats['cpu.getUsed'], 'Total');
        output += formatStat(Memory.stats['cpu.Start'], 'Init');
        output += formatStat(Memory.stats['cpu.CreepManagers'], 'Spawns');
        output += formatStat(Memory.stats['cpu.Creeps'], 'Creeps');
        output += formatStat(Memory.stats['cpu.Towers'], 'Towers');
        output += formatStat(Memory.stats['cpu.stats'], 'Stats');

        return output;
    },

};

module.exports = utilities;
