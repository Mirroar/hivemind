/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('role.claimer');
 * mod.thing == 'a thing'; // true
 */

var gameState = require('game.state');
var utilities = require('utilities');

var roleClaimer = {

    claim: function (creep) {
        var target;
        var targetPosition = utilities.decodePosition(creep.memory.target);
        if (targetPosition.roomName != creep.pos.roomName) {
            creep.moveTo(targetPosition);
            return true;
        }
        target = creep.room.controller;

        var result = creep.claimController(target);
        if (result == ERR_NOT_IN_RANGE) {
            creep.moveTo(target);
        }

        return true;
    },

    reserve: function (creep) {
        var target;
        var targetPosition = utilities.decodePosition(creep.memory.target);
        if (targetPosition.roomName != creep.pos.roomName) {
            creep.moveTo(targetPosition);
            return true;
        }
        target = creep.room.controller;

        var result = creep.reserveController(target);
        if (result == OK) {
            var reservation = 0;
            if (creep.room.controller.reservation && creep.room.controller.reservation.username == 'Mirroar') {
                reservation = creep.room.controller.reservation.ticksToEnd;
            }
            creep.room.memory.lastClaim = {
                time: Game.time,
                value: reservation
            };
        }
        else if (result == ERR_NOT_IN_RANGE) {
            creep.moveTo(target);
        }

        return true;
    },

    /** @param {Creep} creep **/
    run: function (creep) {
        if (creep.memory.mission == 'reserve') {
            return roleClaimer.reserve(creep);
        }
        else if (creep.memory.mission == 'claim') {
            return roleClaimer.claim(creep);
        }
    },

    spawn: function (spawner, targetPosition, mission) {
        var minSize = BODYPART_COST[CLAIM] * 2 + BODYPART_COST[MOVE] * 2;
        if ((spawner.room.energyAvailable >= Math.max(spawner.room.energyCapacityAvailable * 0.9, minSize)) && !spawner.spawning) {
            var body = utilities.generateCreepBody({move: 0.5, claim: 0.5}, spawner.room.energyAvailable);

            if (spawner.canCreateCreep(body) == OK) {
                var newName = spawner.createCreep(body, undefined, {
                    role: 'claimer',
                    target: utilities.encodePosition(targetPosition),
                    mission: mission,
                });
                console.log('Spawning new claimer: ' + newName);

                // Save some stats.
                if (mission == 'reserve' && spawner.room.memory.remoteHarvesting[targetPosition.roomName]) {
                    var cost = 0;
                    for (var i in body) {
                        cost += BODYPART_COST[body[i]];
                    }

                    spawner.room.memory.remoteHarvesting[targetPosition.roomName].creepCost += cost;
                }

                return true;
            }
        }
        return false;
    }
};

module.exports = roleClaimer;
