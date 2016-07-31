// @todo When building walls or ramparts, try to immediately repair them a little as well.

var utilities = require('utilities');

/**
 * Makes the creep use energy to finish construction sites in the current room.
 */
Creep.prototype.performBuild = function () {
    if (Game.cpu.bucket < 500) {
        return false;
    }

    if (!creep.memory.buildTarget) {
        var targets = creep.room.find(FIND_CONSTRUCTION_SITES);
        if (targets.length <= 0) {
            return false;
        }

        creep.memory.buildTarget = utilities.getClosest(creep, targets);
    }
    var best = creep.memory.buildTarget;
    if (!best) {
        return false;
    }
    var target = Game.getObjectById(best);
    if (!target) {
        creep.memory.buildTarget = null;
    }

    if (creep.build(target) == ERR_NOT_IN_RANGE) {
        creep.moveTo(target);
    }
    return true;
};

/**
 * Puts this creep into or out of build mode.
 */
Creep.prototype.setBuilderState = function (building) {
    this.memory.building = building;
    delete this.memory.buildTarget;
    delete this.memory.resourceTarget;
    delete this.memory.tempRole;
};

/**
 * Makes a creep behave like a builder.
 */
Creep.prototype.runBuilderLogic = function () {
    if (this.memory.building && this.carry.energy == 0) {
        this.setBuilderState(false);
    }
    else if (!this.memory.building && this.carry.energy == this.carryCapacity) {
        this.setBuilderState(true);
    }

    if (this.memory.building) {
        return this.performBuild();
    }
    else {
        return this.performGetEnergy();
    }
};
