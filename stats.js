var stats = {

    addRemoteHarvestCost: function (source, target, cost) {
        if (!Memory.rooms[source]) return;

        var memory = Memory.rooms[source];

        if (!memory.remoteHarvesting) {
            memory.remoteHarvesting = {};
        }
        if (!memory.remoteHarvesting[target]) {
            memory.remoteHarvesting[target] = {
                creepCost: 0,
                buildCost: 0,
                revenue: 0,
                harvesters: [],
            };
        }

        memory.remoteHarvesting[target].creepCost += cost;
    },

};

module.exports = stats;
