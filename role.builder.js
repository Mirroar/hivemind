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
        let target = this.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);
        if (!target) {
            return false;
        }

        this.memory.buildTarget = target.id;
    }
    var best = this.memory.buildTarget;
    if (!best) {
        return false;
    }
    var target = Game.getObjectById(best);
    if (!target) {
        this.memory.buildTarget = null;
    }

    this.buildTarget(target);
    return true;
};

Creep.prototype.buildTarget = function (target) {
    if (this.pos.getRangeTo(target) > 3) {
        this.moveToRange(target, 3);
    }
    else {
        this.build(target);

        /*if (target.structureType == STRUCTURE_RAMPART) {
            // Make sure to repair ramparts a bit so they don't get destroyed immediately after 100 ticks.
            this.memory.buildRampartPos = utilities.encodePosition(target.pos);
        }//*/
    }
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
