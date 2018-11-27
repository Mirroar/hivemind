// @todo Mark inaccessible rooms accessible again after a set number of ticks (to revisit with scouts or something similar).

Room.prototype.gatherIntel = function () {
    var room = this;
    if (!room.memory.intel) {
        room.memory.intel = {};
    }
    var intel = room.memory.intel;

    let lastScanThreshold = 500;
    if (Game.cpu.bucket < 5000) {
        lastScanThreshold = 2500;
    }

    if (intel.lastScan && Game.time - intel.lastScan < lastScanThreshold) return;
    hivemind.log('intel', this.name).debug('Gathering intel after', intel.lastScan && Game.time - intel.lastScan || 'infinite', 'ticks.');
    intel.lastScan = Game.time;

    // @todo Check if this could cause problems.
    intel.inaccessible = false;

    // Check room controller.
    intel.owner = null;
    intel.rcl = 0;
    intel.ticksToDowngrade = 0;
    intel.ticksToNeutral = 0;
    intel.hasController = (room.controller ? true : false);
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

    intel.reservation = {
        username: null,
        ticksToEnd: 0,
    };
    if (room.controller && room.controller.reservation) {
        intel.reservation = room.controller.reservation;
    }

    // Check sources.
    var sources = this.find(FIND_SOURCES);
    intel.sources = [];
    intel.sourcePos = [];
    for (let i in sources) {
        intel.sources.push({
            x: sources[i].pos.x,
            y: sources[i].pos.y,
            id: sources[i].id,
        });
    }

    // Check minerals.
    delete intel.mineral;
    delete intel.mineralType;
    var minerals = this.find(FIND_MINERALS);
    for (let i in minerals) {
        intel.mineral = minerals[i].id;
        intel.mineralType = minerals[i].mineralType;
    }

    // Check structures.
    intel.structures = {};
    delete intel.power;
    var structures = room.find(FIND_STRUCTURES);
    for (let i in structures) {
        let structure = structures[i];
        let structureType = structure.structureType;

        // Check for power.
        if (structureType == STRUCTURE_POWER_BANK) {
            // For now, send a notification!
            hivemind.log('intel', this.name).info('Power bank found!');

            // Find out how many access points are around this power bank.
            let terrain = new Room.Terrain(this.name);
            let numFreeTiles = 0;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx == 0 && dy == 0) continue;
                    if (terrain.get(structure.pos.x + dx, structure.pos.y + dy) != TERRAIN_MASK_WALL) {
                        numFreeTiles++;
                    }
                }
            }

            intel.power = {
                amount: structure.power,
                hits: structure.hits,
                decays: Game.time + (structure.ticksToDecay || POWER_BANK_DECAY),
                freeTiles: numFreeTiles,
            };

            // Also store room in strategy memory for easy access.
            if (Memory.strategy) {
                if (!Memory.strategy.power) {
                    Memory.strategy.power = {};
                }
                if (!Memory.strategy.power.rooms) {
                    Memory.strategy.power.rooms = {};
                }
                if (!Memory.strategy.power.rooms[this.name] || !Memory.strategy.power.rooms[this.name].isActive) {
                    Memory.strategy.power.rooms[this.name] = intel.power;
                }
            }
        }
        else if (structureType == STRUCTURE_KEEPER_LAIR || structureType == STRUCTURE_CONTROLLER) {
            if (!intel.structures[structureType]) {
                intel.structures[structureType] = {};
            }
            intel.structures[structureType][structure.id] = {
                x: structure.pos.x,
                y: structure.pos.y,
                hits: structure.hits,
                hitsMax: structure.hitsMax,
            };
        }
    }

    // Remember room exits.
    intel.exits = Game.map.describeExits(room.name);

    // At the same time, create a PathFinder CostMatrix to use when pathfinding through this room.
    var costs = room.generateCostMatrix(structures);
    intel.costMatrix = costs.serialize();

    // @todo Check for portals.

    // @todo Check enemy structures.

    // @todo Maybe even have a modified military CostMatrix that can consider moving through enemy structures.

    // Perform normal scan process.
    room.scan();
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

        // From time to time, prune very old room data.
        if (Game.time % 3738 === 2100) {
            intelManager.pruneRoomMemory();
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
