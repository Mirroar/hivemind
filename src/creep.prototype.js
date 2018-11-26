'use strict';

if (!Creep.prototype.__enhancementsLoaded) {
  require('creep.prototype.movement');

  /**
   * Determines if a creep is dangerous and should be attacked.
   */
  Creep.prototype.isDangerous = function () {
    if (Game.isAlly && Game.isAlly(this.owner.username)) return false;

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
      if (target.structureType == STRUCTURE_LINK && resourceType != RESOURCE_ENERGY) continue;
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

  Creep.prototype.__enhancementsLoaded = true;
}
