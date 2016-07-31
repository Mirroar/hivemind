var statsConsole = require('statsConsole');

var intelManager = {

    setRoomInaccessible: function (roomName) {
        if (!Memory.rooms[roomName]) {
            Memory.rooms[roomName] = {};
        }
        if (!Memory.rooms[roomName].intel) {
            Memory.rooms[roomName].intel = {};
        }

        var intel = Memory.rooms[roomName].intel;

        intel.lastScan = Game.time;
        intel.inaccessible = true;
    },

    scanRoom: function (room) {
        if (!room.memory.intel) {
            room.memory.intel = {};
        }
        var intel = room.memory.intel;

        if (intel.lastScan && Game.time - intel.lastScan < 100) return;
        intel.lastScan = Game.time;

        //statsConsole.log('intel: Scanning room ' + room.name, 0);

        // @todo Check if this could cause problems.
        intel.inaccessible = false;

        // Check room controller.
        intel.owner = null;
        intel.rcl = 0;
        intel.ticksToDowngrade = 0;
        intel.ticksToNeutral = 0;
        if (room.controller && room.controller.owner) {
            intel.owner = room.controller.owner.username;
            intel.rcl = room.controller.level;
            intel.ticksToDowngrade = room.controller.ticksToDowngrade;

            let total = intel.ticksToDowngrade;
            for (let i = 1; i < intel.rcl; i++) {
                total += CONTROLLER_DOWNGRADE[i];
            }
            intel.ticksToNeutral = total;
        }

        // @todo Check sources.

        // @todo Check for power.

        // @todo Check for portals.

        // @todo Check for neutral terminals.

        // @todo Check enemy forces.
    },

    /**
     * Gathers intel in several possible ways.
     */
    scout: function () {
        // Check all currently visible rooms.
        for (let i in Game.rooms) {
            intelManager.scanRoom(Game.rooms[i]);
        }
    },

};

module.exports = intelManager;
