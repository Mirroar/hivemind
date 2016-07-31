var statsConsole = require('statsConsole');

var gameState = require('game.state');
var stats = require('stats');
var utilities = require('utilities');

var Squad = require('manager.squad');

/**
 * Intelligently tries to create a creep.
 *
 * @param options
 *   An object containing conditions for creating this creep:
 *   - body: An array of body part constants to create the creep from.
 *   - bodyWeights: Alternative to body, an array keyed by body part names,
 *     with values describing the percantage of the creep body that should
 *     consist of parts of this type.
 *   - memory: Memory to save on this creep on creation.
 *   - role: Role identifier of the creep, if not set on memory.
 *   - maxCost: Maximum amount of energy to spend on this creep.
 *   - maxParts: An array keyed by body part names containing the maximum
 *     amount of parts of that type to spawn the creep with.
 *
 * @return
 *   The name of the creep if it could be spawned, false otherwise.
 */
StructureSpawn.prototype.createManagedCreep = function (options) {
    if (!options) {
        throw "No options for creep spawning defined.";
    }

    if (this.spawning) {
        return false;
    }

    var enoughEnergy = true;
    if (this.room.energyAvailable < this.room.energyCapacityAvailable * 0.9) {
        enoughEnergy = false;
    }

    if (!options.body) {
        if (!options.bodyWeights) {
            throw "No body definition for creep found.";
        }

        var maxCost = this.room.energyAvailable;
        if (options.maxCost) {
            if (this.room.energyAvailable >= options.maxCost) {
                enoughEnergy = true;
            }
            maxCost = Math.min(maxCost, options.maxCost);
        }

        if (options.maxParts) {
            var maxPartsCost = 0;
            // With theoretically unlimited energy, check how expensive the creep can become with maxSize.
            var tempBody = utilities.generateCreepBody(options.bodyWeights, this.room.energyCapacityAvailable, options.maxParts);
            for (var i in tempBody) {
                maxPartsCost += BODYPART_COST[tempBody[i]];
            }

            if (this.room.energyAvailable >= maxPartsCost) {
                enoughEnergy = true;
            }
            maxCost = Math.min(maxCost, maxPartsCost);
        }

        options.body = utilities.generateCreepBody(options.bodyWeights, maxCost);
    }

    if (!enoughEnergy) {
        return false;
    }

    if (this.canCreateCreep(options.body) !== OK) {
        return false;
    }

    var memory = options.memory;
    if (!memory) {
        memory = {};
    }
    if (!memory.role) {
        memory.role = 'unknown';
        if (options.role) {
            memory.role = options.role;
        }
    }

    memory.body = {};
    for (var i in options.body) {
        if (!memory.body[options.body[i]]) {
            memory.body[options.body[i]] = 0;
        }
        memory.body[options.body[i]]++;
    }

    if (!Memory.creepCounter) {
        Memory.creepCounter = {};
    }
    if (!Memory.creepCounter[memory.role]) {
        Memory.creepCounter[memory.role] = 0;
    }

    var newName = memory.role + '.' + Memory.creepCounter[memory.role];

    var result = this.createCreep(options.body, newName, memory);

    if (result == newName) {
        // Spawning successful.
        Memory.creepCounter[memory.role]++;
        console.log('Spawning new creep:', newName);

        return result;
    }

    return false;
};

/**
 * Handles logic for spawning creeps in rooms, and spawning creeps to go
 * outside of these rooms.
 */
var spawnManager = {

    /**
     * Creates a priority list of creeps that could be spawned for this room.
     */
    getAvailableSpawns: function (room) {
        // @todo Recreate logic from manageSpawns function.
        var builders = _.filter(Game.creeps, (creep) => creep.memory.role == 'builder' && creep.pos.roomName == room.name);
        var numHarvesters = gameState.getNumHarvesters(room.name);
        var repairers = _.filter(Game.creeps, (creep) => creep.memory.role == 'repairer' && creep.pos.roomName == room.name);
        var numTransporters = gameState.getNumTransporters(room.name);
        var upgraders = _.filter(Game.creeps, (creep) => creep.memory.role == 'upgrader' && creep.pos.roomName == room.name);

        var numSources = 0;
        if (room.memory && room.memory.sources) {
            numSources = room.memory.sources.length;
        }
    },

    /**
     * Manages spawning logic for all spawns.
     */
    manageSpawns: function () {
        for (var name in Game.spawns) {
            // @todo Stop spawning for a bit if creeps are queued for renewing.

            // @todo Manage on a per-room basis, if possible.
            var spawn = Game.spawns[name];
            var room = spawn.room;

            // If spawning was just finished, scan the room again to assign creeps.
            if (spawn.spawning) {
                spawn.memory.wasSpawning = true;
            }
            else if (spawn.memory.wasSpawning) {
                spawn.memory.wasSpawning = false;
                utilities.scanRoom(room);
            }

            // Spawn new creeps.
            var builders = _.filter(Game.creeps, (creep) => creep.memory.role == 'builder' && creep.pos.roomName == spawn.pos.roomName);
            var numHarvesters = gameState.getNumHarvesters(spawn.pos.roomName);
            var repairers = _.filter(Game.creeps, (creep) => creep.memory.role == 'repairer' && creep.pos.roomName == spawn.pos.roomName);
            var numTransporters = gameState.getNumTransporters(spawn.pos.roomName);
            var upgraders = _.filter(Game.creeps, (creep) => creep.memory.role == 'upgrader' && creep.pos.roomName == spawn.pos.roomName);
            var mineralHarvesters = _.filter(Game.creeps, (creep) => creep.memory.role == 'harvester.minerals' && creep.pos.roomName == spawn.pos.roomName);
            var minerals = room.find(FIND_MINERALS, {
                filter: (mineral) => {
                    var extractors = room.find(FIND_STRUCTURES, {
                        filter: (structure) => structure.structureType == STRUCTURE_EXTRACTOR && structure.pos.x == mineral.pos.x && structure.pos.y == mineral.pos.y
                    });

                    if (extractors.length > 0) {
                        return true;
                    }
                    return false;
                }
            });

            var numSources = 0;
            var spawnHarvester = false;
            var maxHarvesters = 3;
            var maxTransporters = 2; // @todo Find a good way to gauge needed number of transporters by measuring distances.
            var maxHarvesterSize;
            if (room.memory && room.memory.sources) {
                numSources = _.size(room.memory.sources);
                maxHarvesters = 0;
                maxTransporters = 2 + 2 * numSources;
                for (var id in room.memory.sources) {
                    maxHarvesters += room.memory.sources[id].maxHarvesters;

                    if (!maxHarvesterSize || maxHarvesterSize < room.memory.sources[id].maxWorkParts) {
                        maxHarvesterSize = room.memory.sources[id].maxWorkParts;
                    }

                    var totalWork = 0;
                    for (var i in room.memory.sources[id].harvesters) {
                        var harvester = Game.getObjectById(room.memory.sources[id].harvesters[i]);
                        if (harvester) {
                            totalWork += utilities.getBodyParts(harvester).work;
                        }
                    }

                    if (totalWork < room.memory.sources[id].maxWorkParts && room.memory.sources[id].harvesters.length < room.memory.sources[id].maxHarvesters) {
                        spawnHarvester = true;
                    }

                    // If we have a link to beam energy around, we'll need less transporters.
                    if (room.memory.sources[id].targetLink && room.memory.controllerLink) {
                        maxTransporters--;
                    }
                }
            }

            // Need less transporters if energy gets beamed around the place a lot.
            if (room.memory.controllerLink && room.memory.storageLink) {
                maxTransporters--;
            }

            //console.log(room.name, spawn.pos.roomName, 'Harvesters:', numHarvesters, '/', maxHarvesters);
            //console.log(room.name, spawn.pos.roomName, 'Transporters:', numTransporters, '/', maxTransporters);

            var maxUpgraders = 0;
            if (room.controller.level <= 3) {
                maxUpgraders = 1 + numSources;
            }
            else {
                if (gameState.getStoredEnergy(room) < 100000) {
                    maxUpgraders = 0;
                }
                else if (gameState.getStoredEnergy(room) < 500000) {
                    maxUpgraders = 1;
                }
                else {
                    // @todo Have maximum depend on number of work parts.
                    // @todo Make sure enough energy is brought by.
                    maxUpgraders = 2;
                }
            }
            if (maxUpgraders == 0 && room.controller.ticksToDowngrade < CONTROLLER_DOWNGRADE[room.controller.level] * 0.2) {
                console.log('trying to spawn upgrader because controller is close to downgrading', room.controller.ticksToDowngrade, '/', CONTROLLER_DOWNGRADE[room.controller.level]);
                // Even if no upgraders are needed, at least create one when the controller is getting close to being downgraded.
                maxUpgraders = 1;
            }

            // Only spawn an amount of builders befitting the amount of construction to be done.
            var maxBuilders = 0;
            var constructionSites = room.find(FIND_MY_CONSTRUCTION_SITES);
            if (constructionSites) {
                maxBuilders = Math.min(1 + numSources, Math.ceil(constructionSites.length / 5));
            }
            //console.log(room.name, maxBuilders);

            if (numHarvesters < 1) {
                if (spawnManager.spawnHarvester(spawn, true, maxHarvesterSize)) {
                    return true;
                }
            }
            else if (numTransporters < 1) {
                // @todo Spawn only if there is at least one container / storage.
                if (spawnManager.spawnTransporter(spawn, true)) {
                    return true;
                }
            }
            else if (spawnHarvester) {
                if (spawnManager.spawnHarvester(spawn, false, maxHarvesterSize)) {
                    return true;
                }
            }
            else if (numTransporters < maxTransporters / 2) {
                // @todo Spawn only if there is at least one container / storage.
                if (spawnManager.spawnTransporter(spawn)) {
                    return true;
                }
            }
            else if (upgraders.length < maxUpgraders) {
                if (spawnManager.spawnUpgrader(spawn)) {
                    return true;
                }
            }
            else if (builders.length < maxBuilders) {
                if (spawnManager.spawnBuilder(spawn)) {
                    return true;
                }
            }
            else if (numTransporters < maxTransporters) {
                // @todo Spawn only if there is at least one container / storage.
                if (spawnManager.spawnTransporter(spawn)) {
                    return true;
                }
            }
            else if (repairers.length < 2) {
                // @todo Determine total decay in room and how many worker parts that would need.
                if (spawnManager.spawnRepairer(spawn)) {
                    return true;
                }
            }
            else {
                // Harvest minerals.
                if (mineralHarvesters.length < minerals.length && minerals[0].mineralAmount > 0) {
                    // @todo Do not spawn if we have a lot stored.
                    // We assume there is always at most one mineral deposit in a room.
                    if (spawnManager.spawnMineralHarvester(spawn, minerals[0])) {
                        return true;
                    }
                }

                // Send forces to other rooms.
                var brawlFlags = _.filter(Game.flags, (flag) => {
                    if (flag.name.startsWith('Brawler@')) {
                        var parts = flag.name.match(/^([^@]*)@([^@]*)@/);
                        if (parts && parts[2] == spawn.pos.roomName) {
                            return true;
                        }
                    }
                });
                if (brawlFlags.length > 0) {
                    var position = spawn.pos;
                    if (spawn.room.storage) {
                        position = spawn.room.storage.pos;
                    }

                    for (var i in brawlFlags) {
                        var flag = brawlFlags[i];
                        if (Memory.rooms[flag.pos.roomName].enemies.safe) {
                            continue;
                        }

                        var brawlers = _.filter(Game.creeps, (creep) => {
                            if (creep.memory.role == 'brawler') {
                                if (creep.memory.storage == utilities.encodePosition(position) && creep.memory.target == utilities.encodePosition(flag.pos)) {
                                    return true;
                                }
                            }
                            return false;
                        });

                        if (!brawlers || brawlers.length < 1) {
                            if (spawnManager.spawnBrawler(spawn, flag.pos)) {
                                //Game.notify('Brawler spawned to defend room ' + flag.pos.roomName);
                                return true;
                            }
                        }
                    }
                }

                // Spawn squads.
                var spawnFlags = room.find(FIND_FLAGS, {
                    filter: (flag) => flag.name.startsWith('SpawnSquad:')
                });
                for (var i in spawnFlags) {
                    var flag = spawnFlags[i];
                    var commandParts = flag.name.split(':');
                    var squadName = commandParts[1];

                    if (!Memory.squads[squadName]) continue;

                    //console.log('Spawning squad', squadName);
                    // @todo Initialize Game.squads in main loop and use that.
                    var squad = new Squad(squadName);
                    if (squad.spawnUnit(spawn)) {
                        return true;
                    }
                }

                // If possible, we could claim new rooms!
                var numRooms = _.size(_.filter(Game.rooms, (room) => room.controller && room.controller.my));
                var maxRooms = Game.gcl.level;
                var claimFlags = _.filter(Game.flags, (flag) => flag.name.startsWith('ClaimRoom'));
                if (numRooms < maxRooms && claimFlags.length > 0) {
                    for (var i in claimFlags) {
                        var flag = claimFlags[i];

                        if (Game.rooms[flag.pos.roomName] && Game.rooms[flag.pos.roomName].controller.my) {
                            // Room is already claimed.
                            continue;
                        }
                        // @todo Only if controller is neutral or about to be neutral.

                        // Make sure only the closest room spawns a claimer!
                        var min = null;
                        for (let j in Game.rooms) {
                            if (Game.rooms[j].controller && Game.rooms[j].controller.my) {
                                if (!min || Game.map.getRoomLinearDistance(Game.rooms[j].name, flag.pos.roomName) < min) {
                                    min = Game.map.getRoomLinearDistance(Game.rooms[j].name, flag.pos.roomName);
                                }
                            }
                        }
                        if (Game.map.getRoomLinearDistance(spawn.pos.roomName, flag.pos.roomName) <= min) {
                            var claimers = _.filter(Game.creeps, (creep) => {
                                if (creep.memory.role == 'claimer') {
                                    if (creep.memory.mission == 'claim' && creep.memory.target == utilities.encodePosition(flag.pos)) {
                                        return true;
                                    }
                                }
                                return false;
                            });

                            if (!claimers || claimers.length < 1) {
                                if (spawnManager.spawnClaimer(spawn, flag.pos, 'claim')) {
                                    console.log('sending new claimer to', utilities.encodePosition(flag.pos));
                                    return true;
                                }
                            }
                        }
                    }
                }
                else if (claimFlags.length > 0) {
                    // Check if there are rooms marked for claiming, that belong to us, but have no spawn yet.
                    for (var i in claimFlags) {
                        var flag = claimFlags[i];

                        if (Game.rooms[flag.pos.roomName] && Game.rooms[flag.pos.roomName].controller.my) {
                            // Make sure only the closest room spawn builders!
                            var min = null;
                            for (let j in Game.rooms) {
                                if (Game.rooms[j].controller && Game.rooms[j].controller.my) {
                                    if (!min || Game.map.getRoomLinearDistance(Game.rooms[j].name, flag.pos.roomName) < min) {
                                        min = Game.map.getRoomLinearDistance(Game.rooms[j].name, flag.pos.roomName);
                                    }
                                }
                            }
                            if (Game.map.getRoomLinearDistance(spawn.pos.roomName, flag.pos.roomName) <= min) {
                                var maxRemoteBuilders = 2;
                                var builders = _.filter(Game.creeps, (creep) => {
                                    if (creep.memory.role == 'builder.remote') {
                                        if (creep.memory.target == utilities.encodePosition(flag.pos)) {
                                            return true;
                                        }
                                    }
                                    return false;
                                });

                                if (!builders || builders.length < maxRemoteBuilders) {
                                    if (spawnManager.spawnRemoteBuilder(spawn, flag.pos)) {
                                        console.log('sending new remote builder to', utilities.encodePosition(flag.pos));
                                        return true;
                                    }
                                }
                            }
                        }
                    }
                }

                // We've got nothing to do, how about some remote harvesting?
                var harvestFlags = _.filter(Game.flags, (flag) => flag.name.startsWith('HarvestRemote'));
                for (var i in harvestFlags) {
                    var flag = harvestFlags[i];
                    if (Game.map.getRoomLinearDistance(spawn.pos.roomName, flag.pos.roomName) == 1) {
                        // First of all, if it's not safe, send a bruiser.
                        var roomMemory = Memory.rooms[flag.pos.roomName];
                        if (roomMemory && roomMemory.enemies && !roomMemory.enemies.safe) {
                            var position = spawn.pos;
                            if (spawn.room.storage) {
                                position = spawn.room.storage.pos;
                            }

                            var maxBrawlers = 1;
                            var brawlers = _.filter(Game.creeps, (creep) => {
                                if (creep.memory.role == 'brawler') {
                                    if (creep.memory.storage == utilities.encodePosition(position) && creep.memory.target == utilities.encodePosition(flag.pos)) {
                                        return true;
                                    }
                                }
                                return false;
                            });

                            if (!brawlers || brawlers.length < maxBrawlers) {
                                //console.log('Brawler spawning to defend room ' + flag.pos.roomName);
                                if (spawnManager.spawnBrawler(spawn, flag.pos, 4)) {
                                    //Game.notify('Brawler spawned to defend room ' + flag.pos.roomName);
                                }
                                return true;
                            }
                        }

                        // If it's safe or brawler is sent, start harvesting.
                        var doSpawn = true;
                        if (spawn.room.memory.remoteHarvesting && spawn.room.memory.remoteHarvesting[flag.pos.roomName]) {
                            var memory = spawn.room.memory.remoteHarvesting[flag.pos.roomName];
                            doSpawn = false;

                            memory.harvesters = [];
                            var haulCount = 0;
                            var harvesters = _.filter(Game.creeps, (creep) => creep.memory.role == 'harvester.remote');
                            var haulers = _.filter(Game.creeps, (creep) => creep.memory.role == 'hauler');
                            var maxRemoteHarvesters = 1;
                            var maxRemoteHaulers = 0;
                            if (spawn.room.memory.remoteHarvesting[flag.pos.roomName].revenue > 0) {
                                // Road has been built, can now use multiple harvesters.
                                // maxRemoteHarvesters = flag.name.substring(13, 14) * 1;

                                // @todo Calculate number of needed haulers.
                                maxRemoteHaulers = 2;
                            }

                            var position = spawn.pos;
                            if (spawn.room.storage) {
                                position = spawn.room.storage.pos;
                            }
                            position = utilities.encodePosition(position);

                            var flagPosition = utilities.encodePosition(flag.pos);

                            var maxCarryParts = null;
                            if (memory[flagPosition] && memory[flagPosition].travelTime) {
                                maxCarryParts = Math.ceil(memory[flagPosition].travelTime * SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME / CARRY_CAPACITY);
                                //console.log('Need', maxCarryParts, 'carry parts when transporting remotely harvested energy from', flagPosition);
                            }

                            for (var j in harvesters) {
                                var creep = harvesters[j];
                                //console.log(creep.memory.storage, position, creep.memory.source, flagPosition);
                                // @todo Move into filter function.
                                if (creep.memory.storage == position && creep.memory.source == flagPosition) {
                                    if (!memory[flagPosition] || creep.ticksToLive > memory[flagPosition].travelTime) {
                                        memory.harvesters.push(creep.id);
                                    }
                                }
                            }
                            if (memory.harvesters.length < maxRemoteHarvesters) {
                                doSpawn = true;
                            }

                            for (var j in haulers) {
                                var creep = haulers[j];
                                //console.log(creep.memory.storage, position, creep.memory.source, flagPosition);
                                // @todo Move into filter function.
                                if (creep.memory.storage == position && creep.memory.source == flagPosition) {
                                    if (!memory[flagPosition] || creep.ticksToLive > memory[flagPosition].travelTime) {
                                        haulCount++;
                                    }
                                }
                            }
                            if (haulCount < maxRemoteHaulers && !doSpawn) {
                                // Spawn hauler if necessary, but not if harvester is needed first.
                                if (spawnManager.spawnHauler(spawn, flag.pos, maxCarryParts)) {
                                    return true;
                                }
                            }
                        }

                        if (doSpawn) {
                            if (spawnManager.spawnRemoteHarvester(spawn, flag.pos)) {
                                return true;
                            }
                        }
                    }
                }

                // No harvester spawned? How about some claimers?
                var reserveFlags = _.filter(Game.flags, (flag) => flag.name.startsWith('ReserveRoom'));
                for (var i in reserveFlags) {
                    var flag = reserveFlags[i];
                    // @todo Allow reserving from more than just adjacent rooms.
                    if (Game.map.getRoomLinearDistance(spawn.pos.roomName, flag.pos.roomName) == 1) {

                        doSpawn = false;

                        var claimerIds = [];
                        var claimers = _.filter(Game.creeps, (creep) => creep.memory.role == 'claimer' && creep.memory.mission == 'reserve');
                        var maxClaimers = 1;

                        for (var j in claimers) {
                            var creep = claimers[j];

                            if (creep.memory.target == utilities.encodePosition(flag.pos)) {
                                claimerIds.push(creep.id);
                            }
                        }
                        if (claimerIds.length < maxClaimers) {
                            doSpawn = true;
                        }
                        if (Memory.rooms[flag.pos.roomName]
                            && Memory.rooms[flag.pos.roomName].lastClaim
                            && Memory.rooms[flag.pos.roomName].lastClaim.value + (Memory.rooms[flag.pos.roomName].lastClaim.time - Game.time) > CONTROLLER_RESERVE_MAX * 0.8
                        ) {
                            doSpawn = false;
                        }

                        if (doSpawn) {
                            if (spawnManager.spawnClaimer(spawn, flag.pos, 'reserve')) {
                                return true;
                            }
                        }
                    }
                }

                // Last but not least: Scouts.
                // @todo Spawn scout closest to where we're gonna send it.
                var maxScouts = 1;
                var scouts = _.filter(Game.creeps, (creep) => creep.memory.role == 'scout');
                if (scouts.length < maxScouts) {
                    if (spawnManager.spawnScout(spawn)) {
                        return true;
                    }
                }
            }
        }
    },

    createCreep: function(spawn, body, memory) {
        if (!memory) {
            memory = {};
        }
        if (!memory.role) {
            memory.role = 'unknown';
        }

        if (!Memory.creepCounter) {
            Memory.creepCounter = {};
        }
        if (!Memory.creepCounter[memory.role]) {
            Memory.creepCounter[memory.role] = 0;
        }

        var newName = memory.role + '.' + Memory.creepCounter[memory.role];

        var result = spawn.createCreep(body, newName, memory);

        if (result == newName) {
            // Spawning successful.
            Memory.creepCounter[memory.role]++;
            statsConsole.log('Spawning new creep: ' + newName, 0);
        }

        return result;
    },

    spawnRemoteHarvester: function (spawn, targetPosition) {
        if ((spawn.room.energyAvailable >= spawn.room.energyCapacityAvailable * 0.9) && !spawn.spawning) {
            var body = utilities.generateCreepBody({move: 0.5, work: 0.2, carry: 0.3}, spawn.room.energyAvailable);

            // Use less move parts if a road has already been established.
            if (spawn.room.memory.remoteHarvesting && spawn.room.memory.remoteHarvesting[targetPosition.roomName] && spawn.room.memory.remoteHarvesting[targetPosition.roomName].revenue > 0) {
                // @todo Use calculated max size liek normal harvesters.
                body = utilities.generateCreepBody({move: 0.35, work: 0.55, carry: 0.1}, spawn.room.energyAvailable, {work: 6});
            }

            if (spawn.canCreateCreep(body) == OK) {
                var storage = utilities.encodePosition(spawn.pos);
                if (spawn.room.storage) {
                    storage = utilities.encodePosition(spawn.room.storage.pos);
                }

                var newName = spawnManager.createCreep(spawn, body, {
                    role: 'harvester.remote',
                    storage: storage,
                    source: utilities.encodePosition(targetPosition)
                });

                // Save some stats.
                // @todo Move into a stats module.
                if (!spawn.room.memory.remoteHarvesting) {
                    spawn.room.memory.remoteHarvesting = {};
                }
                if (!spawn.room.memory.remoteHarvesting[targetPosition.roomName]) {
                    spawn.room.memory.remoteHarvesting[targetPosition.roomName] = {
                        creepCost: 0,
                        buildCost: 0,
                        revenue: 0,
                        harvesters: [],
                    };
                }

                var cost = 0;
                for (var i in body) {
                    cost += BODYPART_COST[body[i]];
                }

                spawn.room.memory.remoteHarvesting[targetPosition.roomName].creepCost += cost;

                return true;
            }
        }
        return false;
    },

    spawnBrawler: function (spawn, targetPosition, maxAttackParts) {
        if ((spawn.room.energyAvailable >= spawn.room.energyCapacityAvailable * 0.5) && !spawn.spawning) {
            var maxParts = null;
            if (maxAttackParts) {
                maxParts = {attack: maxAttackParts};
            }
            var body = utilities.generateCreepBody({move: 0.4, tough: 0.3, attack: 0.2, heal: 0.1}, spawn.room.energyAvailable, maxParts);

            if (spawn.canCreateCreep(body) == OK) {
                var position = spawn.pos;
                if (spawn.room.storage) {
                    position = spawn.room.storage.pos;
                }

                var newName = spawnManager.createCreep(spawn, body, {
                    role: 'brawler',
                    storage: utilities.encodePosition(position),
                    target: utilities.encodePosition(targetPosition)
                });
                console.log('Spawning new brawler to defend', utilities.encodePosition(targetPosition), ':', newName);

                // Save some stats.
                // @todo Move into a stats module.
                if (spawn.room.memory.remoteHarvesting && spawn.room.memory.remoteHarvesting[targetPosition.roomName]) {
                    var cost = 0;
                    for (var i in body) {
                        cost += BODYPART_COST[body[i]];
                    }

                    if (!spawn.room.memory.remoteHarvesting[targetPosition.roomName].defenseCost) {
                        spawn.room.memory.remoteHarvesting[targetPosition.roomName].defenseCost = 0;
                    }
                    spawn.room.memory.remoteHarvesting[targetPosition.roomName].defenseCost += cost;
                }

                return true;
            }
        }
        return false;
    },

    spawnClaimer: function (spawn, targetPosition, mission) {
        var minSize = BODYPART_COST[CLAIM] * 2 + BODYPART_COST[MOVE] * 2;
        if ((spawn.room.energyAvailable >= Math.max(spawn.room.energyCapacityAvailable * 0.9, minSize)) && !spawn.spawning) {
            var body = utilities.generateCreepBody({move: 0.5, claim: 0.5}, spawn.room.energyAvailable);

            if (spawn.canCreateCreep(body) == OK) {
                var newName = spawnManager.createCreep(spawn, body, {
                    role: 'claimer',
                    target: utilities.encodePosition(targetPosition),
                    mission: mission,
                });

                // Save some stats.
                if (mission == 'reserve' && spawn.room.memory.remoteHarvesting[targetPosition.roomName]) {
                    var cost = 0;
                    for (var i in body) {
                        cost += BODYPART_COST[body[i]];
                    }

                    spawn.room.memory.remoteHarvesting[targetPosition.roomName].creepCost += cost;
                }

                return true;
            }
        }
        return false;
    },

    /**
     * Spawns a new hauler.
     */
    spawnHauler: function (spawn, targetPosition, maxCarryParts) {
        var maxParts = null;
        if (maxCarryParts) {
            maxParts = {carry: maxCarryParts};
        }

        var position = spawn.pos;
        if (spawn.room.storage) {
            position = spawn.room.storage.pos;
        }

        var result = spawn.createManagedCreep({
            role: 'hauler',
            bodyWeights: {move: 0.35, work: 0.05, carry: 0.6},
            maxParts: maxParts,
            memory: {
                storage: utilities.encodePosition(position),
                source: utilities.encodePosition(targetPosition),
            },
        });

        if (result) {
            var cost = 0;
            for (var part in Memory.creeps[result].body) {
                var count = Memory.creeps[result].body[part];
                cost += BODYPART_COST[part] * count;
            }
            stats.addRemoteHarvestCost(spawn.room.name, utilities.encodePosition(targetPosition), cost);
        }

        return result;
    },

    /**
     * Spawns a new builder.
     */
    spawnBuilder: function (spawn) {
        return spawn.createManagedCreep({
            role: 'builder',
            bodyWeights: {move: 0.35, work: 0.35, carry: 0.3},
            memory: {
                singleRoom: spawn.pos.roomName,
            },
        });
    },

    /**
     * Spawns a new harvester.
     */
    spawnHarvester: function (spawn, force, maxSize) {
        var maxCost = null;
        if (force && spawn.room.energyAvailable >= 200) {
            maxCost = spawn.room.energyAvailable;
        }

        return spawn.createManagedCreep({
            role: 'harvester',
            bodyWeights: {move: 0.1, work: 0.7, carry: 0.2},
            maxCost: maxCost,
            maxParts: maxSize ? {work: maxSize} : null,
            memory: {
                singleRoom: spawn.pos.roomName,
            },
        });
    },

    /**
     * Spawns a new mineral harvester.
     */
    spawnMineralHarvester: function (spawn, source) {
        return spawn.createManagedCreep({
            role: 'harvester.minerals',
            bodyWeights: {move: 0.35, work: 0.3, carry: 0.35},
            memory: {
                singleRoom: spawn.pos.roomName,
                fixedMineralSource: source.id,
            },
        });
    },

    /**
     * Spawns a new repairer.
     */
    spawnRepairer: function (spawn) {
        return spawn.createManagedCreep({
            role: 'repairer',
            bodyWeights: {move: 0.35, work: 0.35, carry: 0.3},
            memory: {
                singleRoom: spawn.pos.roomName,
            },
        });
    },

    /**
     * Spawns a new transporter.
     */
    spawnTransporter: function (spawn, force) {
        var maxCost = 600;
        if (force && spawn.room.energyAvailable >= 250) {
            maxCost = Math.min(maxCost, spawn.room.energyAvailable);
        }

        return spawn.createManagedCreep({
            role: 'transporter',
            bodyWeights: {move: 0.35, carry: 0.65},
            maxCost: maxCost,
            memory: {
                singleRoom: spawn.pos.roomName,
            },
        });
    },

    /**
     * Spawns a new upgrader.
     */
    spawnUpgrader: function (spawn) {
        var bodyWeights = {move: 0.35, work: 0.3, carry: 0.35};
        if (spawn.room.memory.controllerContainer) {
            bodyWeights = {move: 0.2, work: 0.75, carry: 0.05};
        }

        return spawn.createManagedCreep({
            role: 'upgrader',
            bodyWeights: bodyWeights,
            maxParts: {work: 15},
            memory: {
                singleRoom: spawn.pos.roomName,
            },
        });
    },

    /**
     * Spawns a new remote builder.
     */
    spawnRemoteBuilder: function (spawn, targetPosition) {
        return spawn.createManagedCreep({
            role: 'builder.remote',
            bodyWeights: {move: 0.5, carry: 0.3, work: 0.2},
            memory: {
                target: utilities.encodePosition(targetPosition),
                starting: true,
            },
        });
    },

    /**
     * Spawns a new scout.
     */
    spawnScout: function (spawn) {
        return spawn.createManagedCreep({
            role: 'scout',
            body: [MOVE],
            memory: {},
        });
    },

};

module.exports = spawnManager;
