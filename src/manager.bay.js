var Bay = function (flagName) {
    this.flag = Game.flags[flagName];
    this.memory = this.flag.memory;
    this.pos = this.flag.pos;
    this.name = this.flag.name;

    if (this.flag.color != COLOR_GREY) {
        this.flag.setColor(COLOR_GREY);
    }

    if (!this.memory.extensions || Game.time % 100 == 38) {
        let extensions = this.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: (structure) => structure.structureType == STRUCTURE_EXTENSION
        });
        this.memory.extensions = [];
        for (let i in extensions) {
            this.memory.extensions.push(extensions[i].id);
        }
    }

    // @todo Do not add extensions to bay if center is blocked by a structure.

    this.extensions = [];
    this.energy = 0;
    this.energyCapacity = 0;
    if (this.memory.extensions) {
        for (let i in this.memory.extensions) {
            let extension = Game.getObjectById(this.memory.extensions[i]);
            if (extension) {
                this.extensions.push(extension);
                this.energy += extension.energy;
                this.energyCapacity += extension.energyCapacity;
            }
        }
    }

    // Draw bay.
    if (typeof RoomVisual !== 'undefined') {
        let visual = new RoomVisual(this.pos.roomName);
        visual.rect(this.pos.x - 1.4, this.pos.y - 1.4, 2.8, 2.8, {
            fill: 'rgba(255, 255, 128, 0.2)',
            opacity: 0.5,
            stroke: '#ffff80',
        });
    }
};

Bay.prototype.hasExtension = function (extension) {
    for (let i in this.extensions) {
        if (this.extensions[i].id == extension.id) return true;
    }
    return false;
};

Bay.prototype.refillFrom = function (creep) {
    for (let i in this.extensions) {
        let extension = this.extensions[i];
        if (extension.energy < extension.energyCapacity) {
            creep.transfer(extension, RESOURCE_ENERGY);
            break;
        }
    }
};

/**
 * Checks whether this extension belongs to any bay.
 */
StructureExtension.prototype.isBayExtension = function () {
    if (!this.bayChecked) {
        this.bayChecked = true;
        this.bay = null;

        for (let i in this.room.bays) {
            if (this.room.bays[i].hasExtension(this)) {
                this.bay = this.room.bays[i];
                break;
            }
        }
    }

    return this.bay != null;
}

module.exports = Bay;
