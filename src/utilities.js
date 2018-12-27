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

        if (harvestMemory.cachedPath && Game.time - harvestMemory.cachedPath.lastCalculated < 500) {
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
            hivemind.log('pathfinder').debug('New path calculated from', startPosition, 'to', endPosition);

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
                if (!allowDanger && hivemind.roomIntel(roomName).isOwned()) {
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
                // @todo Avoid source keepers.

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
    costMatrixCacheAge: Game.time,

    getCostMatrix: function (roomName, options) {
        // Clear cost matrix cache from time to time.
        if (utilities.costMatrixCacheAge < Game.time - 500) {
            utilities.costMatrixCache = {};
            utilities.costMatrixCacheAge = Game.time;
        }

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
                let terrain = new Room.Terrain(roomName);
                for (let x = 0; x < 50; x++) {
                    for (let y = 0; y < 50; y++) {
                        if (x == 0 || y == 0 || x == 49 || y == 49) {
                            if (terrain.get(x, y) != TERRAIN_MASK_WALL) {
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

};

module.exports = utilities;
