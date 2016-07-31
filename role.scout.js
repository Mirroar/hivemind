var utilities = require('utilities');
var intelManager = require('manager.intel');

/**
 * Creates a priority list of available scouting routes.
 */
Creep.prototype.getAvailableScoutRoutes = function () {
    var options = [];

    // For now find the least recently scanned neighboring room and try to go there.
    var currentRoom = this.room.name;

    var exits = Game.map.describeExits(currentRoom);
    for (var direction in exits) {
        var adjacentRoom = exits[direction];

        if (Game.map.isRoomProtected(adjacentRoom)) continue;

        var option = {
            priority: 3,
            weight: 0,
            route: [{
                direction: direction * 1,
                room: adjacentRoom,
            }],
        };

        if (!Memory.rooms[adjacentRoom] || !Memory.rooms[adjacentRoom].intel) {
            option.priority++;
        }
        else {
            var intel = Memory.rooms[adjacentRoom].intel;

            // Skip inaccessible rooms.
            if (intel.inaccessible) {
                continue;
            }

            // Do not visit recently visited rooms.
            if (Game.time - intel.lastScan < 500) {
                option.priority -= 2;
            }
            else if (Game.time - intel.lastScan < 3000) {
                option.priority--;
            }

            // Do not visit rooms we've been to.
            if (this.memory.visited[adjacentRoom]) {
                option.priority -= 2;
            }

            // @todo Avoid enemy rooms or rooms with source keepers.
        }

        options.push(option);
    }

    return options;
};

/**
 * Chooses the best available scouting route.
 */
Creep.prototype.calculateScoutRoute = function () {
    var best = utilities.getBestOption(this.getAvailableScoutRoutes());

    if (best) {
        this.memory.route = best.route;
    }
    else {
        this.memory.route = [];
    }
    delete this.memory.targetPos;

    this.notifyWhenAttacked(false);
};

/**
 * Makes this creep move between rooms to gather intel.
 */
Creep.prototype.performScout = function () {
    if (this.memory.route.length <= 0) {
        this.moveTo(25, 25);
        return;
    }

    var target = this.memory.route[0];
    if (target.room == this.room.name) {
        //console.log(this.name + ' has reached ' + this.room.name + '!', 3);
        // We reached the target room. go on to the next one.
        this.memory.route.shift();
        delete this.memory.targetPos;
        this.performScout();
        return;
    }

    if (!this.memory.targetPos) {
        var exit = this.pos.findClosestByRange(target.direction * 1);
        //console.log(this.room.find(target.direction));
        if (exit) {
            this.memory.targetPos = utilities.encodePosition(exit);
        }
    }

    if (!this.memory.targetPos) {
        console.log('Scout', this.name, 'cannot find exit to', target.room, 'in direction', target.direction);
        return;
    }

    var targetPos = utilities.decodePosition(this.memory.targetPos);
    this.moveTo(targetPos);
    this.say(target.room);

    // If room cannot be reached after a long time (> 500 ticks), mark it as inaccessible.
    if (this.memory.targetRoomName != target.room) {
        this.memory.targetRoomName = target.room;
        this.memory.targetRoomStartTime = Game.time;
    }

    //console.log('Trying for', Game.time - this.memory.targetRoomStartTime, 'ticks to reach', target.room, targetPos, utilities.encodePosition(this.pos));
    if (Game.time - this.memory.targetRoomStartTime > 200) {
        console.log(this.name, 'cannot reach', target.room);
        intelManager.setRoomInaccessible(target.room);
        this.calculateScoutRoute();
    }
};

/**
 * Makes a creep behave like a scout.
 */
Creep.prototype.runScoutLogic = function () {
    if (!this.memory.visited) {
        this.memory.visited = {};
    }
    if (!this.memory.visited[this.room.name]) {
        this.memory.visited[this.room.name] = true;
    }
    if (!this.memory.route || this.memory.route.length == 0) {
        this.calculateScoutRoute();
    }

    this.performScout();
};
