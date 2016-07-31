var gameState = require('game.state');
var utilities = require('utilities');

/**
 * Makes the creep claim a room for the hive!
 */
Creep.prototype.performClaim = function () {
    var target;
    var targetPosition = utilities.decodePosition(this.memory.target);
    if (targetPosition.roomName != this.pos.roomName) {
        this.moveTo(targetPosition);
        return true;
    }
    target = this.room.controller;

    if (target.owner && !target.my && this.memory.body && this.memory.body.claim >= 5) {
        let result = this.claimController(target);
        if (result == ERR_NOT_IN_RANGE) {
            this.moveTo(target);
        }
    }
    else if (!target.my) {
        let result = this.claimController(target);
        if (result != OK) {
            this.moveTo(target);
        }
    }

    return true;
};

/**
 * Makes the creep reserve a room.
 */
Creep.prototype.performReserve = function () {
    var target;
    var targetPosition = utilities.decodePosition(this.memory.target);
    if (targetPosition.roomName != this.pos.roomName) {
        this.moveTo(targetPosition);
        return true;
    }
    target = this.room.controller;

    var result = this.reserveController(target);
    if (result == OK) {
        var reservation = 0;
        if (this.room.controller.reservation && this.room.controller.reservation.username == 'Mirroar') {
            reservation = this.room.controller.reservation.ticksToEnd;
        }
        this.room.memory.lastClaim = {
            time: Game.time,
            value: reservation
        };
    }
    else if (result == ERR_NOT_IN_RANGE) {
        this.moveTo(target);
    }

    return true;
};

/**
 * Makes a creep behave like a claimer.
 */
Creep.prototype.runClaimerLogic = function () {
    if (this.memory.mission == 'reserve') {
        return this.performReserve();
    }
    else if (this.memory.mission == 'claim') {
        return this.performClaim();
    }
}
