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
