/**
 * Finds all adjacent squares that are not blocked by walls.
 */
Mineral.prototype.getAdjacentFreeSquares = function () {
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

/**
 * Calculates the number of walkable tiles around a mineral.
 */
Mineral.prototype.getNumHarvestSpots = function () {
    if (!this.memory.maxHarvestersCalculated || this.memory.maxHarvestersCalculated < Game.time - 1000) {
        this.memory.maxHarvestersCalculated = Game.time;
        this.memory.maxHarvesters = this.getAdjacentFreeSquares().length;
    }

    return this.memory.maxHarvesters;
};

/**
 * Finds a container in close proximity to this mineral, for dropping off energy.
 */
Mineral.prototype.getNearbyContainer = function () {
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

/**
 * Finds a link in close proximity to this mineral, for dropping off energy.
 */
Mineral.prototype.getNearbyLink = function () {
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
 * Finds a mineral keeper lair in close proximity to this mineral.
 */
Mineral.prototype.getNearbyLair = function () {
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
 * Checks if being close to this mineral is currently dangerous.
 */
Mineral.prototype.isDangerous = function () {
    var lair = this.getNearbyLair();
    if (lair && lair.isDangerous()) {
        // It's still safe if a guardian with sufficient lifespan is nearby to take care of any source keepers.
        if (this.room.creepsByRole.brawler) {
            for (let i in this.room.creepsByRole.brawler) {
                let guardian = this.room.creepsByRole.brawler;
                if (lair.pos.getRangeTo(guardian) < 5 && guardian.ticksToLive > 30) {
                    return false;
                }
            }
        }

        return true;
    }
};
