'use strict';

if (!Room.prototype.__enhancementsLoaded) {
  require('room.prototype.resources');
  require('room.prototype.structures');

  Room.prototype.__enhancementsLoaded = true;
}
