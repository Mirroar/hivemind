/**
 * Adds some additional data to spawn objects. Should be invoked for each spawn early in the script's lifetime.
 */
var enhanceData = function (collection, creepAttribute) {
    var roomMemory = Memory.rooms[this.pos.roomName];

    if (!roomMemory[collection]) {
        roomMemory[collection] = {};
    }
    if (!roomMemory[collection][this.id]) {
        roomMemory[collection][this.id] = {};
    }

    this.memory = roomMemory[collection][this.id];

    // Collect assigned harvesters.
    this.harvesters = [];
    for (let i in this.room.creepsByRole.harvester || []) {
        let harvester = this.room.creepsByRole.harvester[i];

        if (harvester.memory[creepAttribute] == this.id) {
            this.harvesters.push(harvester);
        }
    }
};
Source.prototype.enhanceData = function () {
    enhanceData.call(this, 'sources', 'fixedSource');
};
Mineral.prototype.enhanceData = function () {
    enhanceData.call(this, 'minerals', 'fixedMineral');
};

/**
 * Calculates the maximum number of work parts that should be used when harvesting this source.
 */
Source.prototype.getMaxWorkParts = function () {
    // @todo get Rid of maxWorkParts variable in favor of this.
    return 1.2 * this.energyCapacity / ENERGY_REGEN_TIME / 2;
};

/**
 * Finds all adjacent squares that are not blocked by walls.
 */
var getAdjacentFreeSquares = function () {
    var terrain = this.room.lookForAtArea(LOOK_TERRAIN, this.pos.y - 1, this.pos.x - 1, this.pos.y + 1, this.pos.x + 1, true);
    var adjacentTerrain = [];
    for (var t in terrain) {
        var tile = terrain[t];
        if (tile.x == this.pos.x && tile.y == this.pos.y) {
            continue;
        }

        if (tile.terrain == 'plain' || tile.terrain == 'swamp') {
            // @todo Make sure no structures are blocking this tile.
            adjacentTerrain.push(this.room.getPositionAt(tile.x, tile.y));
        }
    }

    return adjacentTerrain;
};
Source.prototype.getAdjacentFreeSquares = function () {
    getAdjacentFreeSquares.call(this);
};
Mineral.prototype.getAdjacentFreeSquares = function () {
    getAdjacentFreeSquares.call(this);
};

/**
 * Decides on a decent dropoff spot for energy close to the source and easily accessible by harvesters.
 */
Source.prototype.getDropoffSpot = function () {
    // Decide on a dropoff-spot that will eventually have a container built.
    // @todo Maybe recalculate once in a while in case structures no block some tiles.
    if (!this.memory.dropoffSpot) {
        var best;
        var bestCount = 0;
        var terrain = this.room.lookForAtArea(LOOK_TERRAIN, this.pos.y - 2, this.pos.x - 2, this.pos.y + 2, this.pos.x + 2, true);
        var adjacentTerrain = this.getAdjacentFreeSquares();

        for (var t in terrain) {
            var tile = terrain[t];
            if (this.pos.getRangeTo(tile.x, tile.y) <= 1) {
                continue;
            }

            if (tile.terrain == 'plain' || tile.terrain == 'swamp') {
                // @todo Make sure no structures are blocking this tile.
                var count = 0;
                for (var u in adjacentTerrain) {
                    var aTile = adjacentTerrain[u];

                    if (aTile.getRangeTo(tile.x, tile.y) <= 1) {
                        count++;
                    }
                }

                if (count > bestCount) {
                    bestCount = count;
                    best = tile;
                }
            }
        }

        if (best) {
            this.memory.dropoffSpot = {x: best.x, y: best.y};
        }
    }

    return this.memory.dropoffSpot;
};

/**
 * Calculates the number of walkable tiles around a source.
 */
var getNumHarvestSpots = function () {
    if (!this.memory.maxHarvestersCalculated || this.memory.maxHarvestersCalculated < Game.time - 1000) {
        this.memory.maxHarvestersCalculated = Game.time;
        this.memory.maxHarvesters = this.getAdjacentFreeSquares().length;
    }

    return this.memory.maxHarvesters;
};
Source.prototype.getNumHarvestSpots = function () {
    getNumHarvestSpots.call(this);
};
Mineral.prototype.getNumHarvestSpots = function () {
    getNumHarvestSpots.call(this);
};

/**
 * Finds a container in close proximity to this source, for dropping off energy.
 */
var getNearbyContainer = function () {
    if (!this.memory.nearbyContainerCalculated || this.memory.nearbyContainerCalculated < Game.time - 150) {
        this.memory.nearbyContainerCalculated = Game.time;
        this.memory.targetContainer = null;

        // Check if there is a container nearby.
        var structures = this.pos.findInRange(FIND_STRUCTURES, 3, {
            filter: (structure) => structure.structureType == STRUCTURE_CONTAINER
        });
        if (structures.length > 0) {
            var structure = this.pos.findClosestByRange(structures);
            this.memory.targetContainer = structure.id;
        }
    }

    if (this.memory.targetContainer) {
        return Game.getObjectById(this.memory.targetContainer);
    }
};
Source.prototype.getNearbyContainer = function () {
    getNearbyContainer.call(this);
};
Mineral.prototype.getNearbyContainer = function () {
    getNearbyContainer.call(this);
};

/**
 * Finds a link in close proximity to this source, for dropping off energy.
 */
Source.prototype.getNearbyLink = function () {
    if (!this.memory.nearbyLinkCalculated || this.memory.nearbyLinkCalculated < Game.time - 1000) {
        this.memory.nearbyLinkCalculated = Game.time;
        this.memory.targetLink = null;

        // Check if there is a link nearby.
        var structures = this.pos.findInRange(FIND_STRUCTURES, 3, {
            filter: (structure) => structure.structureType == STRUCTURE_LINK
        });
        if (structures.length > 0) {
            var structure = this.pos.findClosestByRange(structures);
            this.memory.targetLink = structure.id;
        }
    }

    if (this.memory.targetLink) {
        return Game.getObjectById(this.memory.targetLink);
    }
};

/**
 * Finds a source keeper lair in close proximity to this source.
 */
Source.prototype.getNearbyLair = function () {
    if (!this.memory.nearbyLairCalculated || this.memory.nearbyLairCalculated < Game.time - 123456) {
        // This information really shouldn't ever change.
        this.memory.nearbyLairCalculated = Game.time;
        this.memory.nearbyLair = null;

        // Check if there is a link nearby.
        var structures = this.pos.findInRange(FIND_STRUCTURES, 10, {
            filter: (structure) => structure.structureType == STRUCTURE_KEEPER_LAIR
        });
        if (structures.length > 0) {
            var structure = this.pos.findClosestByRange(structures);
            this.memory.nearbyLair = structure.id;
        }
    }

    if (this.memory.nearbyLair) {
        return Game.getObjectById(this.memory.nearbyLair);
    }
};

/**
 * Checks if being close to this source is currently dangerous.
 */
Source.prototype.isDangerous = function () {
    var lair = this.getNearbyLair();
    if (lair && lair.isDangerous()) {
        // It's still safe if a guardian with sufficient lifespan is nearby to take care of any source keepers.
        if (this.room.creepsByRole.brawler) {
            for (let i in this.room.creepsByRole.brawler) {
                let guardian = this.room.creepsByRole.brawler[i];
                if (lair.pos.getRangeTo(guardian) < 5 && guardian.ticksToLive > 30 && guardian.memory.exploitUnitType == 'guardian') {
                    return false;
                }
            }
        }

        return true;
    }
};
