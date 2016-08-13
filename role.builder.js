// @todo When building walls or ramparts, try to immediately repair them a little as well.

var utilities = require('utilities');

/**
 * Makes the creep use energy to finish construction sites in the current room.
 */
Creep.prototype.performBuild = function () {
    if (Game.cpu.bucket < 500) {
        return false;
    }

    if (!this.memory.buildTarget) {
        var targets = this.room.find(FIND_CONSTRUCTION_SITES);
        if (targets.length <= 0) {
            return false;
        }

        this.memory.buildTarget = utilities.getClosest(this, targets);
    }
    var best = this.memory.buildTarget;
    if (!best) {
        return false;
    }
    var target = Game.getObjectById(best);
    if (!target) {
        this.memory.buildTarget = null;
    }

    if (this.build(target) == ERR_NOT_IN_RANGE) {
        this.moveToRange(target, 3);
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
