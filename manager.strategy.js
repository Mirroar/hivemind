var strategyManager = {

    runLogic: function () {

        var roomList = strategyManager.generateScoutTargets();

        // @todo Create scouts when no observer in range of a listed room, and send scouts to those rooms.

    },

    generateScoutTargets: function () {
        let roomList = {};

        // Starting point for scouting operations are owned rooms.
        for (let roomName in Game.rooms) {
            let room = Game.rooms[roomName];
            if (!room.controller || !room.controller.my) continue;

            let openList = {};
            openList[roomName] = {range: 0};
            let closedList = {};

            // @todo Flood fill from center of room and add rooms we need intel of.
        }

        return roomList;
    },

};

module.exports = strategyManager;
