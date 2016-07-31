var Bay = function (flagName) {
    this.flag = Game.flags[flagName];
    this.memory = this.flag.memory;
    this.pos = this.flag.pos;

    if (this.flag.color != COLOR_GREY) {
        this.flag.setColor(COLOR_GREY);
    }

    if (!this.memory.extensions || Game.time % 100 == 38) {
        var extensions = this.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: (structure) => structure.structureType == STRUCTURE_EXTENSION
        });
        this.memory.extensions = [];
        for (let i in extensions) {
            this.memory.extensions.push(extensions[i].id);
        }
    }

    this.extensions = [];
    if (this.memory.extensions) {
        for (let i in this.memory.extensions) {
            let extension = Game.getObjectById(this.memory.extensions[i]);
            if (extension) {
                this.extensions.push(extension);
            }
        }
    }
};

Bay.prototype.hasExtension = function (extension) {
    for (let i in this.extensions) {
        if (this.extensions[i].id == extension.id) return true;
    }
    return false;
};

module.exports = Bay;
