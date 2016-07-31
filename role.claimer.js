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

        if (target.owner && !target.my && creep.memory.body && creep.memory.body.claim >= 5) {
            var result = creep.claimController(target);
            if (result == ERR_NOT_IN_RANGE) {
                creep.moveTo(target);
            }
        }
        else if (!target.my) {
            var result = creep.claimController(target);
            if (result != OK) {
                creep.moveTo(target);
            }
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

};

module.exports = roleClaimer;
