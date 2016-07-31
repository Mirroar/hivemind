/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('role.upgrader');
 * mod.thing == 'a thing'; // true
 */

var roleTransporter = require('role.transporter');
var utilities = require('utilities');

var roleUpgrader = {

    /**
     * Puts this creep into or out of upgrade mode.
     */
    setUpgrading: function (creep, upgrading) {
        creep.memory.upgrading = upgrading;
        delete creep.memory.tempRole;
    },

    /** @param {Creep} creep **/
    run: function(creep) {
        if (creep.memory.upgrading && creep.carry.energy == 0) {
            roleUpgrader.setUpgrading(creep, false);
        }
        if (!creep.memory.upgrading && (creep.carry.energy == creep.carryCapacity || (creep.carry.energy > 0 && creep.room.memory.controllerContainer))) {
            roleUpgrader.setUpgrading(creep, true);
        }

        if (creep.memory.upgrading) {
            // Upgrade controller.
            if (creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
                creep.moveTo(creep.room.controller);
            }

            // Keep syphoning energy from link or controller to ideally never stop upgrading.
            // Only real upgraders do this, though, otherwise other primary roles will never stop upgrading.
            if (creep.memory.role == 'upgrader' && _.sum(creep.carry) < creep.carryCapacity) {
                var withdrawn = false;
                if (creep.room.memory.controllerLink) {
                    var controllerLink = Game.getObjectById(creep.room.memory.controllerLink);
                    if (controllerLink.energy > 0 && creep.pos.getRangeTo(controllerLink) <= 1) {
                        if (creep.withdraw(controllerLink, RESOURCE_ENERGY) == OK) {
                            withdrawn = true;
                        }
                    }
                }
                if (!withdrawn && creep.room.memory.controllerContainer) {
                    var controllerContainer = Game.getObjectById(creep.room.memory.controllerContainer);
                    if (controllerContainer.store.energy > 0 && creep.pos.getRangeTo(controllerContainer) <= 1) {
                        if (creep.withdraw(controllerContainer, RESOURCE_ENERGY) == OK) {
                            withdrawn = true;
                        }
                    }
                }
            }
            return true;
        }
        else {
            // Ideally, get energy from a link or container close to the controller.
            if (creep.room.memory.controllerLink) {
                var target = Game.getObjectById(creep.room.memory.controllerLink);
                if (target) {
                    var result = creep.withdraw(target, RESOURCE_ENERGY);
                    if (result == OK) {
                        return true;
                    }
                    else if (result == ERR_NOT_IN_RANGE) {
                        creep.moveTo(target);
                        return true;
                    }
                }
            }

            if (creep.room.memory.controllerContainer) {
                var target = Game.getObjectById(creep.room.memory.controllerContainer);
                if (target) {
                    var result = creep.withdraw(target, RESOURCE_ENERGY);
                    if (result == OK) {
                        return true;
                    }
                    else if (result == ERR_NOT_IN_RANGE) {
                        creep.moveTo(target);
                        return true;
                    }
                }
            }

            // Could also try to get energy from another nearby container.
            var otherContainers = creep.room.controller.pos.findInRange(FIND_STRUCTURES, 3, {
                filter: (structure) => structure.structureType == STRUCTURE_CONTAINER && structure.store.energy > 0 && structure.id != creep.room.memory.controllerContainer
            });
            if (otherContainers && otherContainers.length > 0) {
                var result = creep.withdraw(otherContainers[0], RESOURCE_ENERGY);
                if (result == OK) {
                    return true;
                }
                else if (result == ERR_NOT_IN_RANGE) {
                    creep.moveTo(otherContainers[0]);
                    return true;
                }
            }

            // Otherwise, get energy from anywhere.
            if (roleTransporter.getEnergy(creep)) {
                return true;
            }
            else if (creep.carry.energy > 0) {
                roleUpgrader.setUpgrading(creep, true);
            }
            return false;
        }
    },

};

module.exports = roleUpgrader;
