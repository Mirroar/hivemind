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

Room.prototype.addStructureReference = function (structureType) {
  if (!this.controller) return;
  if (CONTROLLER_STRUCTURES[structureType][this.controller.level] == 0) return;

  if (!this.memory.structureCache) {
    this.memory.structureCache = {};
  }
  let cache = this.memory.structureCache;

  if (!cache[structureType] || cache[structureType].lastCheck + 250 < Game.time) {
    cache[structureType] = {
      lastCheck: Game.time,
    };

    // @todo Cache filtered find requests in room.
    let structures = this.find(FIND_STRUCTURES, {filter: {structureType: structureType}});

    if (structures.length > 0) {
      cache[structureType].id = structures[0].id;
    }
  }

  if (cache[structureType].id) {
    this[structureType] = Game.getObjectById(cache[structureType].id);

    if (!this[structureType]) {
      delete cache[structureType].id;
    }
  }
};
