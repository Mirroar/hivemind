'use strict';

var Relations = function () {
  this.allies = [];

  try {
    let localRelations = require('relations.local');

    if (localRelations.allies) {
      for (let i in localRelations.allies) {
        this.allies.push(localRelations.allies[i]);
      }
    }
  }
  catch (e) {
    // No local relations declared, ignore.
  }
};

Relations.prototype.isAlly = function (username) {
  return this.allies.indexOf(username) !== -1;
};

module.exports = Relations;
