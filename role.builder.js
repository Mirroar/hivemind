/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('role.builder');
 * mod.thing == 'a thing'; // true
 */

// @todo When building walls or ramparts, try to immediately repair them a little as well.

var roleTransporter = require('role.transporter');
var utilities = require('utilities');

var roleBuilder = {

    /** @param {Creep} creep **/
    run: function (creep) {

        if (creep.memory.building && creep.carry.energy == 0) {
            creep.memory.building = false;
            creep.memory.buildTarget = null;
            creep.memory.tempRole = null;
        }
        else if (!creep.memory.building && creep.carry.energy == creep.carryCapacity) {
            creep.memory.building = true;
            creep.memory.resourceTarget = null;
            creep.memory.tempRole = null;
        }

        if (creep.memory.building) {
            var targets = creep.room.find(FIND_CONSTRUCTION_SITES);
            if (targets.length <= 0) {
                return false;
            }

            if (!creep.memory.buildTarget) {
                creep.memory.resourceTarget = null;
                creep.memory.buildTarget = utilities.getClosest(creep, targets);
            }
            var best = creep.memory.buildTarget;
            if (!best) {
                return false;
            }
            var target = Game.getObjectById(best);
            if (!target) {
                creep.memory.buildTarget = null;
            }

            if (creep.build(target) == ERR_NOT_IN_RANGE) {
                creep.moveTo(target);
            }
            return true;
        }
        else {
            return roleTransporter.getEnergy(creep);
        }
    },

    spawn: function (spawner) {
        if (spawner.room.energyAvailable >= spawner.room.energyCapacityAvailable * 0.9 && !spawner.spawning) {
            var body = utilities.generateCreepBody({move: 0.2, work: 0.3, carry: 0.5}, spawner.room.energyAvailable);
            if (spawner.canCreateCreep(body) == OK) {
                var newName = spawner.createCreep(body, undefined, {role: 'builder'});
                console.log('Spawning new builder: ' + newName);
                return true;
            }
        }
        return false;
    }
};

module.exports = roleBuilder;
