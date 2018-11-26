'use strict';

Room.prototype.getCreepsWithOrder = function (type, target) {
  return _.filter(this.creeps, (creep) => {
    if (creep.memory.order) {
      if (creep.memory.order.type == type && creep.memory.order.target == target) {
        return true;
      }
    }
    return false;
  });
};
