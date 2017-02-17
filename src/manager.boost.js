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
                // Only boost using the best boosts. We'll make sure we have what we need through trading.
                if (mineralType.indexOf('X') == -1) continue;

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
    if (this.isEvacuating()) return false;

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
    var boostLabs = [];
    if (!this.boostManager) return boostLabs;

    if (true || !this.memory.boostManager.labLastChecked || this.memory.boostManager.labLastChecked < Game.time - 953) {
        this.memory.boostManager.labLastChecked = Game.time;

        var labs = this.find(FIND_STRUCTURES, {
            filter: (structure) => {
                if (structure.structureType != STRUCTURE_LAB) return false;
                if (this.memory.labs && _.contains(this.memory.labs.reactor, structure.id)) return false;
                if (this.memory.labs && structure.id == this.memory.labs.source1) return false;
                if (this.memory.labs && structure.id == this.memory.labs.source2) return false;

                return true;
            }
        });

        if (labs.length > 0) {
            if (!this.memory.boostManager.labs[labs[0].id]) {
                this.memory.boostManager.labs = {};
                this.memory.boostManager.labs[labs[0].id] = {};
            }
        }
    }

    for (let id in this.memory.boostManager.labs || []) {
        let lab = Game.getObjectById(id);
        if (lab) {
            boostLabs.push(lab);
        }
    }

    return boostLabs;
};

var BoostManager = function (roomName) {
    this.roomName = roomName;
    this.room = Game.rooms[roomName];

    if (!Memory.rooms[roomName].boostManager) {
        Memory.rooms[roomName].boostManager = {};
    }

    this.memory = Memory.rooms[roomName].boostManager;

    if (!this.memory.creepsToBoost) {
        this.memory.creepsToBoost = {};
    }
    if (!this.memory.labs) {
        this.memory.labs = {};
    }

    // @todo Clean out this.memory.creepsToBoost of creeps that no longer exist.
};

/**
 * Prepares memory for boosting a new creep.
 */
BoostManager.prototype.markForBoosting = function (creepName, boosts) {
    if (!boosts || !creepName) return;
    let memory = Memory.creeps[creepName];

    if (!memory) return;

    memory.needsBoosting = true;
    this.memory.creepsToBoost[creepName] = {};

    for (let bodyPart in boosts) {
        let resourceType = boosts[bodyPart];
        let numParts = memory.body[bodyPart] || 0;

        this.memory.creepsToBoost[creepName][resourceType] = numParts;
    }
};

/**
 * Overrides a creep's logic while it's being boosted.
 */
BoostManager.prototype.overrideCreepLogic = function (creep) {
    if (!creep.memory.needsBoosting) return false;

    if (!this.memory.creepsToBoost[creep.name]) {
        delete creep.memory.needsBoosting;
        return false;
    }

    let memory = this.memory.creepsToBoost[creep.name];
    if (_.size(memory) == 0) {
        delete this.memory.creepsToBoost[creep.name];
        delete creep.memory.needsBoosting;
        return false;
    }

    for (let resourceType in memory) {
        // Find lab to get boosted at.
        for (let id in this.memory.labs) {
            if (this.memory.labs[id].resourceType != resourceType) continue;

            let lab = Game.getObjectById(id);
            if (!lab) continue;

            if (creep.pos.getRangeTo(lab) > 1) {
                creep.moveToRange(lab, 1);
            }
            else {
                // If there is enough energy and resources, boost!
                if (lab.mineralType == resourceType && lab.mineralAmount >= memory[resourceType] * LAB_BOOST_MINERAL && lab.energy >= memory[resourceType] * LAB_BOOST_ENERGY) {
                    if (lab.boostCreep(creep) == OK) {
                        // @todo Prevent trying to boost another creep with this lab on this turn.
                        // Awesome, boost has been applied (in theory).
                        // Clear partial memory, to prevent trying to boost again.
                        delete memory[resourceType];
                    }
                }
            }
            return true;
        }
    }

    return false;
};

/**
 * Gets a list of labs and their designated resource types.
 */
BoostManager.prototype.getLabOrders = function () {
    var labs = this.room.getBoostLabs();

    if (_.size(this.memory.creepsToBoost) == 0) return {};

    var queuedBoosts = {};
    var toDelete = [];
    for (let creepName in this.memory.creepsToBoost) {
        if (!Game.creeps[creepName]) {
            toDelete.push(creepName);
            continue;
        }

        for (let resourceType in this.memory.creepsToBoost[creepName]) {
            queuedBoosts[resourceType] = (queuedBoosts[resourceType] || 0) + this.memory.creepsToBoost[creepName][resourceType];
        }
    }

    for (let i in toDelete) {
        delete this.memory.creepsToBoost[toDelete[i]];
    }

    for (let i in labs) {
        let lab = labs[i];

        if (!this.memory.labs[lab.id]) {
            this.memory.labs[lab.id] = {};
        }
        if (!this.memory.labs[lab.id].resourceType || !queuedBoosts[this.memory.labs[lab.id].resourceType]) {
            let unassigned = _.filter(_.keys(queuedBoosts), (resourceType) => {
                return _.filter(labs, (lab) => this.memory.labs[lab.id].resourceType == resourceType).length == 0;
            });

            if (unassigned.length == 0) {
                delete this.memory.labs[lab.id].resourceType;
            }
            else {
                this.memory.labs[lab.id].resourceType = unassigned[0];
            }
        }
        if (this.memory.labs[lab.id].resourceType) {
            let resourceType = this.memory.labs[lab.id].resourceType;
            this.memory.labs[lab.id].resourceAmount = queuedBoosts[resourceType] * LAB_BOOST_MINERAL;
            this.memory.labs[lab.id].energyAmount = queuedBoosts[resourceType] * LAB_BOOST_ENERGY;
        }
        else {
            delete this.memory.labs[lab.id].resourceAmount;
            delete this.memory.labs[lab.id].energyAmount;
        }
    }

    // Make sure to delete memory of any labs no longer used for boosting.
    let unused = _.filter(_.keys(this.memory.labs), (id) => {
        return _.filter(labs, (lab) => lab.id == id).length == 0;
    });
    for (let i in unused) {
        delete this.memory.labs[unused[i]];
    }

    return this.memory.labs;
};

/**
 * Decides whether helper creeps need to be spawned in this room.
 */
BoostManager.prototype.needsSpawning = function () {
    var maxHelpers = 1;
    var numHelpers = _.filter(this.room.creepsByRole.helper || [], (creeps) => true).length;

    if (numHelpers < maxHelpers) {
        // Make sure we actually need helpers.
        if (_.size(this.memory.creepsToBoost) > 0) {
            return true;
        }
    }

    return false;
};

/**
 * Spawns a helper when necessary.
 */
BoostManager.prototype.spawn = function (spawn) {
    spawn.createManagedCreep({
        role: 'helper',
        body: [MOVE, MOVE, CARRY, CARRY, CARRY, CARRY],
        memory: {
            singleRoom: this.roomName,
        },
    });
};

module.exports = BoostManager;
