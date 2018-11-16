'use strict';

/**
 * Moves creep within a certain range of a target.
 */
Creep.prototype.moveToRange = function (target, range) {
  return this.goTo(target, {range: range});
};
