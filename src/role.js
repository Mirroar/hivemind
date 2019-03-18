'use strict';

/**
 * Base class for creep roles.
 * @constructor
 */
const Role = function () {
};

Role.prototype.throttleAt = 8000;
Role.prototype.stopAt = 2000;

module.exports = Role;
