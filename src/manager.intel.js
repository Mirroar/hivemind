// @todo Mark inaccessible rooms accessible again after a set number of ticks (to revisit with scouts or something similar).

var intelManager = {

    getControllerPosition: function (roomName) {
        if (!Memory.rooms[roomName] || !Memory.rooms[roomName].intel) return;
        let intel = Memory.rooms[roomName].intel;
        if (!intel.structures || !intel.structures[STRUCTURE_CONTROLLER]) return;

        let controllers = intel.structures[STRUCTURE_CONTROLLER];
        for (let i in controllers) {
            return new RoomPosition(controllers[i].x, controllers[i].y, roomName);
        }
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
