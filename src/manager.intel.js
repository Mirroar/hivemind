// @todo Mark inaccessible rooms accessible again after a set number of ticks (to revisit with scouts or something similar).

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

    isRoomInaccessible: function (roomName) {
        if (!Memory.rooms[roomName]) {
            return false;
        }
        if (!Memory.rooms[roomName].intel) {
            return false;
        }

        var intel = Memory.rooms[roomName].intel;
        if (_.size(Game.spawns) > 0 && intel.owner && intel.owner != _.sample(Game.spawns).owner.username) {
            return true;
        }

        return intel.inaccessible;
    },

    pruneRoomMemory: function () {
        let count = 0;
        for (let i in Memory.rooms) {
            if (Memory.rooms[i].intel && Memory.rooms[i].intel.lastScan < Game.time - 100000) {
                delete Memory.rooms[i];
                count++;
                continue;
            }

            if (Memory.rooms[i].roomPlanner && (!Game.rooms[i] || !Game.rooms[i].controller || !Game.rooms[i].controller.my)) {
                delete Memory.rooms[i].roomPlanner;
                count++;
            }
        }

        if (count > 0) {
            console.log('Pruned old memory for', count, 'rooms.');
        }
    },

};

module.exports = intelManager;
