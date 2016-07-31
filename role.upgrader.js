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
            if (creep.upgradeController(creep.room.controller) == ERR_NOT_IN_RANGE) {
                creep.moveTo(creep.room.controller);
            }
            return true;
        }
        else {
            // Ideally, get energy from a container close to the controller.
            if (creep.room.memory.controllerContainer) {
                var target = Game.getObjectById(creep.room.memory.controllerContainer);
                if (target.transfer(creep, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(target);
                }
                return true;
            }

            // Otherwise, get energy from anywhere.
            if (roleTransporter.getEnergy(creep)) {
                return true;
            }
            return false;
        }
    },

    spawn: function (spawner) {
        if (spawner.room.energyAvailable >= spawner.room.energyCapacityAvailable * 0.9 && !spawner.spawning) {
            var bodyWeights = {move: 0.1, work: 0.3, carry: 0.6};
            if (spawner.room.memory.controllerContainer) {
                bodyWeights = {move: 0.1, work: 0.7, carry: 0.2};
            }
            var body = utilities.generateCreepBody(bodyWeights, spawner.room.energyAvailable);
            if (spawner.canCreateCreep(body) == OK) {
                var newName = spawner.createCreep(body, undefined, {role: 'upgrader'});
                console.log('Spawning new upgrader: ' + newName);
                return true;
            }
        }
        return false;
    }
};

module.exports = roleUpgrader;