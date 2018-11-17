'use strict';

var Process = require('process');

var ManageLinksProcess = function (params, data) {
  Process.call(this, params, data);
  this.room = params.room;
};
ManageLinksProcess.prototype = Object.create(Process.prototype);

/**
 * Moves energy between links.
 *
 * @todo Determine which links serve as energy input or output, and transfer
 * dynamically between those.
 */
ManageLinksProcess.prototype.run = function () {
  // Pump energy into upgrade controller link when possible to keep the upgrades flowing.
  if (this.room.memory.controllerLink) {
    var controllerLink = Game.getObjectById(this.room.memory.controllerLink);
    if (controllerLink && controllerLink.energy <= controllerLink.energyCapacity * 0.5) {
      var upgradeControllerSupplied = false;

      if (this.room.memory.sources) {
        for (var id in this.room.memory.sources) {
          if (!this.room.memory.sources[id].targetLink) continue;

          // We have a link next to a source. Good.
          var link = Game.getObjectById(this.room.memory.sources[id].targetLink);
          if (!link) continue;

          if (link.energy >= link.energyCapacity * 0.5 && link.cooldown <= 0) {
            link.transferEnergy(controllerLink);
            upgradeControllerSupplied = true;
          }
        }
      }

      if (!upgradeControllerSupplied && this.room.memory.storageLink) {
        var storageLink = Game.getObjectById(this.room.memory.storageLink);
        if (storageLink) {
          if (storageLink.energy >= storageLink.energyCapacity * 0.5 && storageLink.cooldown <= 0) {
            storageLink.transferEnergy(controllerLink);
            upgradeControllerSupplied = true;
          }
        }
      }
    }
  }
};

module.exports = ManageLinksProcess;
