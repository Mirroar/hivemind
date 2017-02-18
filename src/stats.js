var stats = {

    initRemoteHarvestMemory: function (source, target) {
        var memory = Memory.rooms[source];

        if (!memory.remoteHarvesting) {
            memory.remoteHarvesting = {};
        }
        if (!memory.remoteHarvesting[target]) {
            memory.remoteHarvesting[target] = {
                creepCost: 0,
                defenseCost: 0,
                buildCost: 0,
                revenue: 0,
                harvesters: [],
            };
        }
    },

    clearRemoteHarvestStats: function (source, target) {
        if (!Memory.rooms[source]) return;

        var memory = Memory.rooms[source];
        stats.initRemoteHarvestMemory(source, target);

        memory.remoteHarvesting[target].creepCost = 0;
        memory.remoteHarvesting[target].defenseCost = 0;
        memory.remoteHarvesting[target].buildCost = 0;
        memory.remoteHarvesting[target].revenue = 0;
    },

    addRemoteHarvestCost: function (source, target, cost) {
        if (!Memory.rooms[source]) return;

        var memory = Memory.rooms[source];
        stats.initRemoteHarvestMemory(source, target);

        memory.remoteHarvesting[target].creepCost += cost;
    },

    addRemoteHarvestDefenseCost: function (source, target, cost) {
        if (!Memory.rooms[source]) return;

        var memory = Memory.rooms[source];
        stats.initRemoteHarvestMemory(source, target);

        memory.remoteHarvesting[target].defenseCost += cost;
    },

    /**
     * Saves a new stat value for long term history tracking.
     */
    recordStat: function (key, value) {
        if (!Memory.history) {
            Memory.history = {};
        }
        if (!Memory.history[key]) {
            Memory.history[key] = {};
        }

        stats.saveStatValue(Memory.history[key], 1, value);
    },

    /**
     * Recursively saves new data in long term history.
     */
    saveStatValue: function (memory, multiplier, value) {
        var increment = 10;

        if (typeof memory[multiplier] === 'undefined') {
            memory[multiplier] = {
                currentValues: [],
                previousValues: [],
            };
        }

        if (memory[multiplier].currentValues.length >= increment) {
            var avg = 0;
            for (var i in memory[multiplier].currentValues) {
                avg += memory[multiplier].currentValues[i];
            }
            avg /= memory[multiplier].currentValues.length;

            stats.saveStatValue(memory, multiplier * increment, avg);

            memory[multiplier].previousValues = memory[multiplier].currentValues;
            memory[multiplier].currentValues = [];
        }

        memory[multiplier].currentValues.push(value);
    },

    /**
     * Retrieves long term history data.
     */
    getStat: function (key, interval) {
        // @todo Allow intervals that are not directly stored, like 300.
        if (!Memory.history || !Memory.history[key] || !Memory.history[key][interval]) {
            return null;
        }

        return _.last(Memory.history[key][interval].currentValues);
    },
};

module.exports = stats;
