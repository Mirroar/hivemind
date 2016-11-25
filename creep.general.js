var utilities = require('utilities');

/**
 * Determines if a creep is dangerous and should be attacked.
 */
Creep.prototype.isDangerous = function () {
    // Ignore Alekseyka's creeps when remote harvesting.
    if ((this.pos.roomName == 'E46S41' || this.pos.roomName == 'E46S42' || this.pos.roomName == 'E47S41') && this.owner.username == 'Alekseyka') {
        return false;
    }
    if (this.owner.username == 'Voronoi') return false;

    for (let j in this.body) {
        let type = this.body[j].type;

        if (type != MOVE && type != CARRY && type != TOUGH) {
            return true;
        }
    }
    return false;
};

/**
 * Transfer resources to a target, if the creep carries any.
 */
Creep.prototype.transferAny = function (target) {
    for (let resourceType in this.carry) {
        if (this.carry[resourceType] > 0) {
            return this.transfer(target, resourceType);
        }
    }

    return ERR_NOT_ENOUGH_RESOURCES;
};

/**
 * Drop resources on the ground, if the creep carries any.
 */
Creep.prototype.dropAny = function () {
    for (let resourceType in this.carry) {
        if (this.carry[resourceType] > 0) {
            return this.drop(resourceType);
        }
    }

    return ERR_NOT_ENOUGH_RESOURCES;
};

module.exports = {

    getCreepsWithOrder: function(type, target, room) {
        if (room) {
            return _.filter(room.creeps, (creep) => {
                if (creep.memory.order) {
                    if (creep.memory.order.type == type && creep.memory.order.target == target) {
                        return true;
                    }
                }
                return false;
            });
        }
        else {
            return _.filter(Game.creeps, (creep) => {
                if (creep.memory.order) {
                    if (creep.memory.order.type == type && creep.memory.order.target == target) {
                        return true;
                    }
                }
                return false;
            });
        }
    }

};
