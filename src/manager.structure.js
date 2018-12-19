// @todo Build containers automatically at calculated dropoff spots.

var utilities = require('utilities');

StructureKeeperLair.prototype.isDangerous = function () {
    return !this.ticksToSpawn || this.ticksToSpawn < 20;
};

/**
 * Starts evacuation process for a room to prepare it for being abandoned.
 */
Room.prototype.setEvacuating = function (evacuate) {
    this.memory.isEvacuating = evacuate;
};

/**
 * Checks if a room is currently evacuating.
 */
Room.prototype.isEvacuating = function () {
    return this.memory.isEvacuating;
};

/**
 * Starts emptying a rooms terminal and keeps it empty.
 */
Room.prototype.setClearingTerminal = function (clear) {
    this.memory.isClearingTerminal = clear;
};

/**
 * Checks if a room's terminal should be emptied.
 */
Room.prototype.isClearingTerminal = function () {
    return this.memory.isClearingTerminal;
};

var structureManager = {

};

module.exports = structureManager;
