var statsConsole = require('statsConsole');

var utilities = require('utilities');
var intelManager = require('manager.intel');

var roleScout = {

    getAvailableScoutRoutes: function (creep) {
        var options = [];

        // For now find the least recently scanned neighboring room and try to go there.
        var currentRoom = creep.room.name;

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

                // @todo Avoid enemy rooms or rooms with source keepers.
            }

            options.push(option);
        }

        return options;
    },

    calculateScoutRoute: function (creep) {
        var best = utilities.getBestOption(roleScout.getAvailableScoutRoutes(creep));

        if (best) {
            creep.memory.route = best.route;
        }
        else {
            creep.memory.route = [];
        }
        delete creep.memory.targetPos;

        creep.notifyWhenAttacked(false);
    },

    move: function (creep) {
        if (creep.memory.route.length <= 0) {
            creep.moveTo(25, 25);
            return;
        }

        var target = creep.memory.route[0];
        if (target.room == creep.room.name) {
            //statsConsole.log(creep.name + ' has reached ' + creep.room.name + '!', 3);
            // We reached the target room. go on to the next one.
            creep.memory.route.shift();
            delete creep.memory.targetPos;
            roleScout.move(creep);
            return;
        }

        if (!creep.memory.targetPos) {
            var exit = creep.pos.findClosestByRange(target.direction * 1);
            //console.log(creep.room.find(target.direction));
            if (exit) {
                creep.memory.targetPos = utilities.encodePosition(exit);
            }
        }

        if (!creep.memory.targetPos) {
            statsConsole.log('Scout ' + creep.name + ' cannot find exit to ' + target.room + ' in direction ' + target.direction, 4);
            return;
        }

        var targetPos = utilities.decodePosition(creep.memory.targetPos);
        creep.moveTo(targetPos);
        creep.say(target.room);

        // If room cannot be reached after a long time (> 500 ticks), mark it as inaccessible.
        if (creep.memory.targetRoomName != target.room) {
            creep.memory.targetRoomName = target.room;
            creep.memory.targetRoomStartTime = Game.time;
        }

        //console.log('Trying for', Game.time - creep.memory.targetRoomStartTime, 'ticks to reach', target.room, targetPos, utilities.encodePosition(creep.pos));
        if (Game.time - creep.memory.targetRoomStartTime > 200) {
            statsConsole.log(creep.name + ' cannot reach ' + target.room + '!', 4);
            intelManager.setRoomInaccessible(target.room);
            roleScout.calculateScoutRoute(creep);
        }
    },

    run: function (creep) {
        //console.log('scout reporting.');

        if (!creep.memory.route || creep.memory.route.length == 0) {
            roleScout.calculateScoutRoute(creep);
        }

        roleScout.move(creep);
    },

};

module.exports = roleScout;
