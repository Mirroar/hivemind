'use strict';

var LinkNetwork = require('link_network');

/**
 * Moves creep within a certain range of a target.
 */
Room.prototype.generateLinkNetwork = function () {
  var links = this.find(FIND_MY_STRUCTURES, {
    filter: {
      structureType: STRUCTURE_LINK,
    },
  });

  if (links.length <= 0) {
    return;
  }

  this.linkNetwork = new LinkNetwork();
  // @todo Controller and source links should be gotten through functions that
  // use the room planner.
  let controllerLinkId = this.memory.controllerLink;
  let sourceLinkIds = [];
  if (this.memory.sources) {
    for (let id in this.memory.sources) {
      if (this.memory.sources[id].targetLink) {
        sourceLinkIds.push(this.memory.sources[id].targetLink);
      }
    }
  }

  // Add links to network.
  for (let i in links) {
    let link = links[i];

    if (link.id == controllerLinkId) {
      if (sourceLinkIds.indexOf(link.id) >= 0) {
        this.linkNetwork.addInOutLink(link);
      }
      else {
        this.linkNetwork.addOutLink(link);
      }
    }
    else {
      if (sourceLinkIds.indexOf(link.id) >= 0) {
        this.linkNetwork.addInLink(link);
      }
      else {
        this.linkNetwork.addNeutralLink(link);
      }
    }
  }
};

Room.prototype.addObserverReference = function () {
    if (!this.controller) return;

    if (CONTROLLER_STRUCTURES[STRUCTURE_OBSERVER][this.controller.level] == 0) return;

    if (!this.memory.observerId) {
        if (!this.memory.observerChecked || this.memory.observerChecked + 250 < Game.time) {
            this.memory.observerChecked = Game.time;

            let structures = this.find(FIND_STRUCTURES, {filter: {structureType: STRUCTURE_OBSERVER}});

            for (let i in structures) {
                this.memory.observerId = structures[i].id;
            }
        }
    }

    this.observer = Game.getObjectById(this.memory.observerId);

    if (this.memory.observerId && !this.observer) {
        delete this.memory.observerId;
    }
};

Room.prototype.addNukerReference = function () {
    if (!this.controller) return;

    if (CONTROLLER_STRUCTURES[STRUCTURE_NUKER][this.controller.level] == 0) return;

    if (!this.memory.nukerId) {
        if (!this.memory.nukerChecked || this.memory.nukerChecked + 250 < Game.time) {
            this.memory.nukerChecked = Game.time;

            let structures = this.find(FIND_STRUCTURES, {filter: {structureType: STRUCTURE_NUKER}});

            for (let i in structures) {
                this.memory.nukerId = structures[i].id;
            }
        }
    }

    this.nuker = Game.getObjectById(this.memory.nukerId);

    if (this.memory.nukerId && !this.nuker) {
        delete this.memory.nukerId;
    }
};

Room.prototype.addPowerSpawnReference = function () {
    if (!this.controller) return;

    if (CONTROLLER_STRUCTURES[STRUCTURE_POWER_SPAWN][this.controller.level] == 0) return;

    if (!this.memory.powerSpawnId) {
        if (!this.memory.powerSpawnChecked || this.memory.powerSpawnChecked + 250 < Game.time) {
            this.memory.powerSpawnChecked = Game.time;

            let structures = this.find(FIND_STRUCTURES, {filter: {structureType: STRUCTURE_POWER_SPAWN}});

            for (let i in structures) {
                this.memory.powerSpawnId = structures[i].id;
            }
        }
    }

    this.powerSpawn = Game.getObjectById(this.memory.powerSpawnId);

    if (this.memory.powerSpawnId && !this.powerSpawn) {
        delete this.memory.powerSpawnId;
    }
};
