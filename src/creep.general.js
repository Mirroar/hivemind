module.exports = {

    getCreepsWithOrder: function(type, target, room) {
        let creeps = Game.creeps;
        if (room) {
            creeps = room.creeps;
        }

        return _.filter(creeps, (creep) => {
            if (creep.memory.order) {
                if (creep.memory.order.type == type && creep.memory.order.target == target) {
                    return true;
                }
            }
            return false;
        });
    }

};
