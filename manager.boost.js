/**
 * Collects available boosts in a room, optionally filtered by effect.
 */
Room.prototype.getAvailableBoosts = function (type) {
    if (!this.boostsCache) {
        var boosts = {};

        let storage = this.storage || {store:{}};
        let terminal = this.terminal || {store:{}};
        let resourceTypes = _.union(_.keys(storage.store), _.keys(terminal.store));

        for (let workPart in BOOSTS) {
            let mineralBoosts = BOOSTS[workPart];
            for (let mineralType in mineralBoosts) {
                let boostValues = mineralBoosts[mineralType];

                if (_.indexOf(resourceTypes, mineralType) != -1) {
                    for (let boostType in boostValues) {
                        if (!boosts[boostType]) {
                            boosts[boostType] = {};
                        }

                        boosts[boostType][mineralType] = {
                            effect: boostValues[boostType],
                            available: Math.floor((storage.store[mineralType] || 0 + terminal.store[mineralType] || 0) / 10),
                        };
                    }
                }
            }
        }

        this.boostsCache = boosts;
    }

    if (type) {
        return this.boostsCache[type];
    }

    return this.boostsCache;
};

/**
 * Decides if spawning of boosted creeps is available in this room.
 * Requires at least one unused lab.
 */
Room.prototype.canSpawnBoostedCreeps = function () {
    var labs = this.getBoostLabs();

    if (labs.length > 0) {
        return true;
    }
    return false;
};

/**
 * Gets labs used for boosting creeps in this room.
 */
Room.prototype.getBoostLabs = function () {
    var labs = [];
    if (!this.boostManager) return labs;

    if (!this.memory.boostManager.labLastChecked || this.memory.boostManager.labLastChecked < Game.time - 953) {
        this.memory.boostManager.labLastChecked = Game.time;

        var labs = this.find(FIND_STRUCTURES, {
            filter: (structure) => structure.structureType == STRUCTURE_LAB && !_.contains(_.values(this.memory.labs), structure.id)
        });

        if (labs.length > 0) {
            this.memory.boostManager.labs = [labs[0].id];
        }
    }

    for (let id of this.memory.boostManager.labs || []) {
        let lab = Game.getObjectById(id);
        if (lab) {
            labs.push(lab);
        }
    }

    return labs;
};

var BoostManager = function (roomName) {
    this.roomName = roomName;

    if (!Memory.rooms[roomName].boostManager) {
        Memory.rooms[roomName].boostManager = {};
    }

    this.memory = Memory.rooms[roomName].boostManager;
};

BoostManager.prototype.needsSpawning = function () {
    // @todo
};

BoostManager.prototype.spawn = function (spawn) {
    // @todo
};

module.exports = BoostManager;
