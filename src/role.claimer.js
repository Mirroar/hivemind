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
        if (this.pos.getRangeTo(target) > 1) {
            this.moveTo(target);
        }
        else {
            this.claimController(target);
        }
    }
    else if (!target.my) {
        var numRooms = _.size(_.filter(Game.rooms, (room) => room.controller && room.controller.my));
        var maxRooms = Game.gcl.level;

        if (this.pos.getRangeTo(target) > 1) {
            this.moveTo(target);
        }
        else if(numRooms < maxRooms) {
            this.claimController(target);
        }
        else {
            this.reserveController(target);
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

    if (this.pos.getRangeTo(target) > 1) {
        this.moveTo(target);
    }
    else {
        var result = this.reserveController(target);
        if (result == OK) {
            var reservation = 0;
            if (this.room.controller.reservation && this.room.controller.reservation.username == utilities.getUsername()) {
                reservation = this.room.controller.reservation.ticksToEnd;
            }
            this.room.memory.lastClaim = {
                time: Game.time,
                value: reservation,
            };
        }
    }

    return true;
};

/**
 * Makes a creep behave like a claimer.
 */
Creep.prototype.runClaimerLogic = function () {
    var targetPosition = utilities.decodePosition(this.memory.target);
    if (!this.hasCachedPath() && Memory.rooms[this.room.name].remoteHarvesting && Memory.rooms[this.room.name].remoteHarvesting[this.memory.target]) {
        var harvestMemory = Memory.rooms[this.room.name].remoteHarvesting[this.memory.target];

        if (harvestMemory.cachedPath) {
            this.setCachedPath(harvestMemory.cachedPath.path, false, 1);
        }
    }

    if (this.hasCachedPath()) {
        if (this.hasArrived() || this.pos.getRangeTo(targetPosition) < 3) {
            this.clearCachedPath();
        }
        else {
            this.followCachedPath();
            return;
        }
    }

    if (this.memory.mission == 'reserve') {
        return this.performReserve();
    }
    else if (this.memory.mission == 'claim') {
        return this.performClaim();
    }
};
