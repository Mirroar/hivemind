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

};

module.exports = intelManager;
