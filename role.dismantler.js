var utilities = require('utilities');

/**
 * Makes the creep use energy to finish construction sites in the current room.
 */
Creep.prototype.performDismantle = function () {
    // First, get to target room.
    if (this.pos.roomName != this.memory.targetRoom) {
        this.moveTo(new RoomPosition(25, 25, this.memory.targetRoom));
        return true;
    }

    // Look for dismantle flags.
    var flags = this.room.find(FIND_FLAGS, {
        filter: (flag) => flag.name.startsWith('Dismantle:')
    });
    if (flags.length > 0) {
        for (let i in flags) {
            let flag = flags[i];
            let structures = flag.pos.lookFor(LOOK_STRUCTURES);

            if (structures.length == 0) {
                // Done dismantling.
                flag.remove();
                continue;
            }

            let target = structures[0];
            if (this.pos.getRangeTo(target) > 1) {
                this.moveTo(target);
            }
            else {
                this.dismantle(target);
            }
            return true;
        }

        return true;
    }

    return true;
};

Creep.prototype.performDismantlerDeliver = function () {
    // First, get to delivery room.
    if (this.pos.roomName != this.memory.sourceRoom) {
        this.moveTo(new RoomPosition(25, 25, this.memory.sourceRoom));
        return true;
    }

    // Deliver to storage if possible.
    if (this.room.storage) {
        if (this.pos.getRangeTo(this.room.storage) > 1) {
            this.moveTo(this.room.storage);
        }
        else {
            this.transferAny(this.room.storage);
        }
        return true;
    }

    let location = this.room.getStorageLocation();
    let pos = new RoomPosition(location.x, location.y, this.pos.roomName);
    if (this.pos.getRangeTo(pos) > 0) {
        this.moveTo(pos);
    }
    else {
        this.dropAny();
    }

    return true;
};

/**
 * Puts this creep into or out of build mode.
 */
Creep.prototype.setDismantlerState = function (dismantling) {
    this.memory.dismantling = dismantling;
};

/**
 * Makes a creep behave like a builder.
 */
Creep.prototype.runDismantlerLogic = function () {
    if (!this.memory.sourceRoom) {
        this.memory.sourceRoom = this.pos.roomName;
    }
    if (!this.memory.targetRoom) {
        this.memory.targetRoom = this.pos.roomName;
    }

    if (this.memory.dismantling && this.carryCapacity > 0 && _.sum(this.carry) >= this.carryCapacity) {
        this.setDismantlerState(false);
    }
    else if (!this.memory.dismantling && _.sum(this.carry) == 0) {
        this.setDismantlerState(true);
    }

    if (this.memory.dismantling) {
        return this.performDismantle();
    }
    else {
        this.performDismantlerDeliver();
        return true;
    }
};
