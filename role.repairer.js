// @todo Try to have different targets.
// @todo Use energy from storage.
// @todo Walls and ramparts should be repaired to the same amount, not percentage.

var creepGeneral = require('creep.general');
var utilities = require('utilities');

var wallHealth = {
    0: 1,
    1: 5000,
    2: 30000,
    3: 100000,
    4: 300000,
    5: 1000000,
    6: 2000000,
    7: 5000000,
    8: 300000000,
};

/**
 * Collects information about all damaged buildings in the current room.
 */
Creep.prototype.getAvailableRepairTargets = function () {
    var creep = this;
    var options = [];

    var targets = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => structure.hits < structure.hitsMax
    });

    for (var i in targets) {
        var target = targets[i];

        var option = {
            priority: 4,
            weight: 1 - target.hits / target.hitsMax, // @todo Also factor in distance.
            type: 'structure',
            object: target,
        };

        var maxHealth = target.hitsMax;
        if (target.structureType == STRUCTURE_WALL || target.structureType == STRUCTURE_RAMPART) {
            option.priority--;

            // Walls and ramparts get repaired up to a certain health level.
            maxHealth = wallHealth[target.room.controller.level];
            if (target.hits >= maxHealth) {
                // Skip this.
                continue;
            }
            option.weight = 1 - target.hits / maxHealth;
            option.maxHealth = maxHealth;
        }

        if (target.hits / maxHealth > 0.9) {
            option.priority--;
        }
        if (target.hits / maxHealth < 0.2) {
            option.priority++;
        }

        // Roads are not that important, repair only when low.
        if (target.structureType == STRUCTURE_ROAD && target.hits > 1000) {
            option.priority--;
        }

        // For many decaying structures, we don't care if they're "almost" full.
        if (target.structureType == STRUCTURE_ROAD || target.structureType == STRUCTURE_RAMPART || target.structureType == STRUCTURE_CONTAINER) {
            if (target.hits / maxHealth > 0.9) {
                continue;
            }
        }

        // Slightly adjust weight so that closer structures get prioritized.
        option.weight -= creep.pos.getRangeTo(target) / 100;

        option.priority -= creepGeneral.getCreepsWithOrder('repair', target.id).length;

        options.push(option);
    }

    return options;
};

/**
 * Sets a good energy source target for this creep.
 */
Creep.prototype.calculateRepairTarget = function () {
    var creep = this;
    var best = utilities.getBestOption(creep.getAvailableRepairTargets());

    if (best) {
        //console.log('best repair target for this', creep.memory.role , ':', best.object.structureType, best.object.id, '@ priority', best.priority, best.weight, 'HP:', best.object.hits, '/', best.object.hitsMax);
        creep.memory.repairTarget = best.object.id;

        creep.memory.order = {
            type: 'repair',
            target: best.object.id,
            maxHealth: best.maxHealth,
        };
    }
    else {
        delete creep.memory.repairTarget;
        delete creep.memory.order;
    }
};

/**
 * Makes the creep repair damaged buildings.
 */
Creep.prototype.performRepair = function () {
    var creep = this;
    if (!creep.memory.repairTarget) {
        creep.calculateRepairTarget();
    }
    var best = creep.memory.repairTarget;
    if (!best) {
        return false;
    }
    var target = Game.getObjectById(best);
    if (!target) {
        return false;
    }
    var maxHealth = target.hitsMax;
    if (creep.memory.order.maxHealth) {
        maxHealth = creep.memory.order.maxHealth;

        // Repair ramparts past their maxHealth to counteract decaying.
        if (target.structureType == STRUCTURE_RAMPART) {
            maxHealth = Math.min(maxHealth + 10000, target.hitsMax);
        }
    }
    if (!target || !target.hits || target.hits >= maxHealth) {
        creep.calculateRepairTarget();
    }

    if (creep.pos.getRangeTo(target) > 3) {
        creep.moveToRange(target, 3);

        // Also try to repair things that are close by when appropriate.
        if (Game.cpu.bucket > 9500 && (this.carry.energy > this.carryCapacity * 0.7 || this.carry.energy < this.carryCapacity * 0.3)) {
            creep.repairNearby();
        }
    }
    else {
        creep.repair(target);
    }
    return true;
};

/**
 * While not actively working on anything else, use carried energy to repair nearby structures.
 */
Creep.prototype.repairNearby = function () {
    let workParts = this.memory.body.work;
    if (workParts) {
        var needsRepair = this.pos.findInRange(FIND_STRUCTURES, 3, {
            filter: (structure) => {
                let maxHealth = structure.hitsMax;
                if (structure.structureType == STRUCTURE_RAMPART || structure.structureType == STRUCTURE_WALL) {
                    maxHealth = wallHealth[structure.room.controller.level];
                }
                if (structure.hits <= maxHealth - workParts * 100) {
                    return true;
                }
            }
        });
        if (needsRepair.length > 0) {
            this.repair(needsRepair[0]);
        }
    }
};

/**
 * Puts this creep into or out of repair mode.
 */
Creep.prototype.setRepairState = function (repairing) {
    this.memory.repairing = repairing;
    delete this.memory.repairTarget;
    delete this.memory.tempRole;
};

Creep.prototype.runRepairerLogic = function () {
    if (this.memory.repairing && this.carry.energy == 0) {
        this.setRepairState(false);
    }
    else if (!this.memory.repairing && this.carry.energy == this.carryCapacity) {
        this.setRepairState(true);
    }

    if (this.memory.repairing) {
        if (Game.cpu.bucket < 500) {
            return;
        }
        return this.performRepair();
    }
    else {
        return this.performGetEnergy();
    }
};
