var stats = {

    initRemoteHarvestMemory: function (source, target) {
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
    },

    addRemoteHarvestCost: function (source, target, cost) {
        if (!Memory.rooms[source]) return;

        var memory = Memory.rooms[source];
        stats.initRemoteHarvestMemory(source, target);

        memory.remoteHarvesting[target].creepCost += cost;
    },

};

module.exports = stats;
