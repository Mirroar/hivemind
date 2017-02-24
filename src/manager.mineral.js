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
