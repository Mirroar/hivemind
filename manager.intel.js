Room.prototype.gatherIntel = function () {
    var room = this;
    if (!room.memory.intel) {
        room.memory.intel = {};
    }
    var intel = room.memory.intel;

    if (intel.lastScan && Game.time - intel.lastScan < 100) return;
    intel.lastScan = Game.time;

    //console.log('intel: Scanning room ' + room.name, 0);

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

    // Check sources.
    var sources = this.find(FIND_SOURCES);
    intel.sources = [];
    for (let i in sources) {
        intel.sources.push(sources[i].id);
    }

    // @todo Check for power.

    // @todo Check for portals.

    // @todo Check for neutral terminals.

    // @todo Check enemy forces.
};

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

    /**
     * Gathers intel in several possible ways.
     */
    scout: function () {
        // Check all currently visible rooms.
        for (let i in Game.rooms) {
            try {
                Game.rooms[i].gatherIntel();
            }
            catch (e) {
                console.log(e);
                console.log(e.stack);
            }
        }
    },

};

module.exports = intelManager;
