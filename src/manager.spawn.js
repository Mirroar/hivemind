var gameState = require('game.state');
var stats = require('stats');
var utilities = require('utilities');
var intelManager = require('manager.intel');

var Squad = require('manager.squad');

var roleNameMap = {
    builder: 'B',
    'builder.exploit': 'BE',
    'builder.remote': 'BR',
    claimer: 'C',
    dismantler: 'D',
    brawler: 'F',
    guardian: 'FE',
    harvester: 'H',
    'harvester.exploit': 'HE',
    'harvester.minerals': 'HM',
    'harvester.remote': 'HR',
    'harvester.power': 'HP',
    repairer: 'R',
    scout: 'S',
    transporter: 'T',
    'hauler.exploit': 'TE',
    'hauler.power': 'TP',
    hauler: 'TR',
    upgrader: 'U',
};

// @todo Choose the best spawn for a creep (distance to target).

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
    var minCost = this.room.energyCapacityAvailable * 0.9;
    if (options.minCost) {
        minCost = options.minCost;
    }
    if (this.room.energyAvailable < minCost) {
        enoughEnergy = false;
    }

    var maxCost = Math.max(minCost, this.room.energyAvailable);
    if (!options.body) {
        if (!options.bodyWeights) {
            throw "No body definition for creep found.";
        }

        // Creep might be requested with a maximum energy cost.
        if (options.maxCost) {
            maxCost = Math.min(maxCost, options.maxCost);
        }

        // Creep might be requested with a part limit.
        var maxPartsCost = 0;
        // With theoretically unlimited energy, check how expensive the creep can become with maxSize.
        var tempBody = utilities.generateCreepBody(options.bodyWeights, this.room.energyCapacityAvailable, options.maxParts);
        for (var i in tempBody) {
            maxPartsCost += BODYPART_COST[tempBody[i]];
        }

        maxCost = Math.min(maxCost, maxPartsCost);

        options.body = utilities.generateCreepBody(options.bodyWeights, maxCost, options.maxParts);
    }
    else {
        // Use the actual cost of a creep with this body.
        var maxPartsCost = 0;
        for (var i in options.body) {
            maxPartsCost += BODYPART_COST[options.body[i]];
        }
        maxCost = Math.min(maxCost, maxPartsCost);
    }

    if (this.room.energyAvailable >= maxCost) {
        enoughEnergy = true;
    }

    if (!enoughEnergy || this.canCreateCreep(options.body) !== OK) {
        return false;
    }

    // Prepare creep memory.
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

    // Store creep's body definition in memory for easier access.
    memory.body = {};
    for (var i in options.body) {
        if (!memory.body[options.body[i]]) {
            memory.body[options.body[i]] = 0;
        }
        memory.body[options.body[i]]++;
    }

    // Generate creep name.
    if (!Memory.creepCounter) {
        Memory.creepCounter = {};
    }
    if (!Memory.creepCounter[memory.role] || Memory.creepCounter[memory.role] >= 36 * 36) {
        Memory.creepCounter[memory.role] = 0;
    }
    var roleName = memory.role;
    if (roleNameMap[roleName]) {
        roleName = roleNameMap[roleName];
    }
    var newName = roleName + '_' + Memory.creepCounter[memory.role].toString(36);

    // Actually try to spawn this creep.
    var result = this.createCreep(options.body, newName, memory);

    if (result == newName) {
        // Spawning successful.
        Memory.creepCounter[memory.role]++;
        new Game.logger('creeps', this.pos.roomName).log('Spawning new creep:', newName);

        // Also notify room's boost manager if necessary.
        if (options.boosts && this.room.boostManager) {
            this.room.boostManager.markForBoosting(newName, options.boosts);
        }

        // Store role of spawning creep for visualization.
        this.memory.spawnRole = memory.role;

        return result;
    }

    return false;
};

/**
 * WIP Replacement of manageSpawns using a priority queue and more caches.
 */
Room.prototype.manageSpawnsPriority = function () {
    if (!this.controller || !this.controller.my) {
        return;
    }

    this.spawnOptions = {};

    var roomSpawns = _.filter(Game.spawns, (spawn) => spawn.pos.roomName == this.name);
    // If all spawns are busy, no need to calculate what could be spawned.
    var allSpawning = true;
    var activeSpawn;
    for (let i in roomSpawns) {
        if (!roomSpawns[i].spawning) {
            allSpawning = false;
            activeSpawn = roomSpawns[i];
        }

        // If spawning was just finished, scan the room again to assign creeps.
        if (roomSpawns[i].spawning) {
            roomSpawns[i].memory.wasSpawning = true;
            if (this.visual) {
                this.visual.text(roomSpawns[i].memory.spawnRole, roomSpawns[i].pos.x + 0.05, roomSpawns[i].pos.y + 0.05, {
                    size: 0.5,
                    color: 'black',
                });
                this.visual.text(roomSpawns[i].memory.spawnRole, roomSpawns[i].pos.x, roomSpawns[i].pos.y, {
                    size: 0.5,
                });
            }
            continue;
        }
        else if (roomSpawns[i].memory.wasSpawning) {
            roomSpawns[i].memory.wasSpawning = false;
            this.scan();
        }
    }
    if (allSpawning) {
        return true;
    }

    // Prepare spawn queue.
    if (!this.memory.spawnQueue) {
        this.memory.spawnQueue = {};
    }
    var memory = this.memory.spawnQueue;
    memory.options = [];

    // Fill spawn queue.
    this.addHarvesterSpawnOptions();
    this.addTransporterSpawnOptions();
    this.addUpgraderSpawnOptions();
    this.addBuilderSpawnOptions();
    this.addExploitSpawnOptions();
    this.addDismantlerSpawnOptions();
    this.addBoostManagerSpawnOptions();
    this.addPowerSpawnOptions();

    // In low level rooms, add defenses!
    if (this.memory.enemies && !this.memory.enemies.safe && this.controller.level < 4 && _.size(this.creepsByRole.brawler) < 2) {
        memory.options.push({
            priority: 5,
            weight: 1,
            role: 'brawler',
        });
    }

    if (memory.options.length > 0) {
        // Try to spawn the most needed creep.
        return this.spawnCreepByPriority(activeSpawn);
    }
    return false;
};

/**
 * Spawns the most needed creep from the priority queue.
 */
Room.prototype.spawnCreepByPriority = function (activeSpawn) {
    var memory = this.memory.spawnQueue;
    var best = utilities.getBestOption(memory.options);

    //console.log(this.name, JSON.stringify(best));
    if (best.role == 'harvester') {
        activeSpawn.spawnHarvester(best.force, best.maxWorkParts, best.source);
    }
    else if (best.role == 'transporter') {
        activeSpawn.spawnTransporter(best.force, best.size);
    }
    else if (best.role == 'upgrader') {
        activeSpawn.spawnUpgrader();
    }
    else if (best.role == 'builder') {
        activeSpawn.spawnBuilder(best.size);
    }
    else if (best.role == 'dismantler') {
        activeSpawn.spawnDismantler(best.targetRoom);
    }
    else if (best.role == 'brawler') {
        activeSpawn.spawnBrawler(this.controller.pos);
    }
    else if (best.role == 'harvester.power') {
        activeSpawn.spawnPowerHarvester(best.targetRoom, best.isHealer);
    }
    else if (best.role == 'hauler.power') {
        activeSpawn.spawnPowerHauler(best.targetRoom);
    }
    else if (best.role == 'exploit') {
        Game.exploits[best.exploit].spawnUnit(activeSpawn, best);
    }
    else if (best.role == 'boosts') {
        Game.rooms[best.roomName].boostManager.spawn(activeSpawn);
    }
    else {
        new Game.logger('creeps', this.name).error('trying to spawn unknown creep role:', best.role);
    }

    return true;
};

/**
 * Checks which sources in this room still need harvesters and adds those to queue.
 */
Room.prototype.addHarvesterSpawnOptions = function () {
    var memory = this.memory.spawnQueue;

    // If we have no other way to recover, spawn with reduced amounts of parts.
    let force = false;
    if (_.size(this.creepsByRole.harvester) == 0 && (!this.storage || (_.size(this.creepsByRole.transporter) == 0 && gameState.getStoredEnergy(this) < 5000))) {
        force = true;
    }

    if (!force && this.isFullOnEnergy()) return;

    for (let i in this.sources) {
        let source = this.sources[i];
        let maxParts = source.getMaxWorkParts();
        // Make sure at least one harvester is spawned for each source.
        if (source.harvesters.length == 0) {
            memory.options.push({
                priority: (force ? 5 : 4),
                weight: 1,
                role: 'harvester',
                source: source.id,
                maxWorkParts: maxParts,
                force: force,
            });
        }
        else if (this.controller.level <= 3 && source.harvesters.length < source.getNumHarvestSpots()) {
            // If there's still space at this source, spawn additional harvesters until the maximum number of work parts has been reached.
            // Starting from RCL 4, 1 harvester per source should always be enough.
            let totalWorkParts = 0;
            for (let j in source.harvesters) {
                totalWorkParts += source.harvesters[j].memory.body.work || 0;
            }
            for (let j in this.creepsByRole['builder.remote'] || []) {
                totalWorkParts += (this.creepsByRole['builder.remote'][j].memory.body.work || 0) / 2;
            }

            if (totalWorkParts < maxParts) {
                memory.options.push({
                    priority: 4,
                    weight: 1 - (totalWorkParts / maxParts),
                    role: 'harvester',
                    source: source.id,
                    maxWorkParts: maxParts - totalWorkParts,
                    force: false,
                });
            }
        }
    }
};

/**
 * Checks for and spawns more transporters.
 */
Room.prototype.addTransporterSpawnOptions = function () {
    var memory = this.memory.spawnQueue;

    numSources = _.size(this.sources);
    var numTransporters = _.size(this.creepsByRole.transporter);
    var maxTransporters = 2 + 2 * numSources; // @todo Find a good way to gauge needed number of transporters by measuring distances.

    for (var i in this.sources) {
        // If we have a link to beam energy around, we'll need less transporters.
        if (this.sources[i].getNearbyLink() && this.memory.controllerLink) {
            maxTransporters--;
        }
    }

    // Need less transporters if energy gets beamed around the place a lot.
    if (this.memory.controllerLink && this.memory.storageLink) {
        maxTransporters--;
    }

    if (this.controller.level == 6) {
        // RCL 6 is that annoying level at which refilling extensions is very tedious and there are many things that need spawning.
        maxTransporters++;
    }

    // Need less transporters in rooms where remote builders are working.
    maxTransporters -= _.size(this.creepsByRole['builder.remote']);

    // On low level rooms, do not use (too many) transporters.
    if (this.controller.level < 3) {
        maxTransporters = 1;
    }
    if (this.controller.level < 4 || !this.storage) {
        // Storage mostly takes place in containers, units will get their energy from there.
        maxTransporters = 2;
    }

    // On higher level rooms, spawn less, but bigger, transporters.
    var sizeFactor = 1;
    if (this.controller.level >= 7) {
        sizeFactor = 2;
    }
    else if (this.controller.level >= 6) {
        sizeFactor = 1.5;
    }
    else if (this.controller.level >= 5) {
        sizeFactor = 1.25;
    }
    sizeFactor *= 1.5;
    maxTransporters /= 1.2;

    maxTransporters /= sizeFactor;
    maxTransporters = Math.max(maxTransporters, 2);

    if (this.isClearingTerminal() && this.terminal && _.sum(this.terminal.store) > this.terminal.storeCapacity * 0.01) {
        maxTransporters *= 1.5;
    }

    if (numTransporters < maxTransporters) {
        let option = {
            priority: 5,
            weight: 0.5,
            role: 'transporter',
            force: false,
            size: 8 * sizeFactor,
        }

        if (numTransporters >= maxTransporters / 2) {
            option.priority = 4;
        }
        else if (numTransporters > 1) {
            option.weight = 0;
        }
        else {
            option.force = true;
        }
        //console.log(this.name, JSON.stringify(option));

        memory.options.push(option);
    }
};

/**
 * Spawns a number of upgraders appropriate for this room.
 */
Room.prototype.addUpgraderSpawnOptions = function () {
    var memory = this.memory.spawnQueue;

    var numUpgraders = _.size(_.filter(this.creepsByRole.upgrader, (creep) => !creep.ticksToLive || creep.ticksToLive > creep.body.length * 3));
    var maxUpgraders = 0;

    if (this.controller.level <= 3) {
        maxUpgraders = 1 + numSources + Math.floor(gameState.getStoredEnergy(this) / 2000);
        maxUpgraders = Math.min(maxUpgraders, 5);
    }
    else if (this.controller.level == 8) {
        maxUpgraders = 1;
        if (gameState.getStoredEnergy(this) < 50000) {
            maxUpgraders = 0;
        }
    }
    else {
        if (gameState.getStoredEnergy(this) < 100000) {
            maxUpgraders = 0;
        }
        else if (gameState.getStoredEnergy(this) < 300000) {
            maxUpgraders = 1;
        }
        else if (gameState.getStoredEnergy(this) < 500000) {
            maxUpgraders = 2;
        }
        else {
            // @todo Have maximum depend on number of work parts.
            // @todo Make sure enough energy is brought by.
            maxUpgraders = 3;
        }
    }

    if (this.isEvacuating()) maxUpgraders = 0;

    if (!this.storage && !this.terminal && this.find(FIND_MY_CONSTRUCTION_SITES).length > 0) {
        // Do not spawn upgraders when builders and spawns will need most of
        // our energy.
        maxUpgraders = 0;
    }

    if (maxUpgraders == 0 && this.controller.ticksToDowngrade < CONTROLLER_DOWNGRADE[this.controller.level] * 0.5) {
        new Game.logger('creeps', this.name).log('trying to spawn upgrader because controller is close to downgrading', this.controller.ticksToDowngrade, '/', CONTROLLER_DOWNGRADE[this.controller.level]);
        // Even if no upgraders are needed, at least create one when the controller is getting close to being downgraded.
        maxUpgraders = 1;
    }

    if (numUpgraders < maxUpgraders) {
        memory.options.push({
            priority: 3,
            weight: 1,
            role: 'upgrader',
        });
    }
};

/**
 * Spawns a number of repairers to keep buildings in good health.
 */
Room.prototype.addBuilderSpawnOptions = function () {
    var memory = this.memory.spawnQueue;

    var numWorkParts = 0;
    var maxWorkParts = 5;
    var builderSize = null;
    if (this.controller.level > 2) {
        maxWorkParts += 5;
    }

    for (let name in this.creepsByRole.repairer || {}) {
        numWorkParts += this.creepsByRole.repairer[name].memory.body.work || 0;
    }
    for (let name in this.creepsByRole.builder || {}) {
        numWorkParts += this.creepsByRole.builder[name].memory.body.work || 0;
    }

    // There are a lot of ramparts in planned rooms, spawn builders appropriately.
    if (this.roomPlanner && this.roomPlanner.memory.controlRoom && this.roomPlanner.memory.locations && this.controller && this.controller.my && this.controller.level >= 4) {
        maxWorkParts += _.size(this.roomPlanner.memory.locations.rampart || []) / 10;
    }

    // Add more repairers if we have a lot of energy to spare.
    if (this.storage && this.storage.store.energy > 400000) {
        maxWorkParts *= 2;
    }
    else if (this.storage && this.storage.store.energy > 200000) {
        maxWorkParts *= 1.5;
    }

    // Add more builders if we're moving a spawn.
    if (this.memory.roomPlanner && this.memory.roomPlanner.hasMisplacedSpawn) {
        maxWorkParts *= 1.5;
    }

    if (this.controller.level <= 3) {
        if (this.find(FIND_MY_CONSTRUCTION_SITES).length == 0) {
            // There isn't really much to repair before RCL 4, so don't spawn
            // new builders when there's nothing to build.
            maxWorkParts = 0;
        }
    }
    else {
        // Spawn more builders depending on total size of current construction sites.
        // @todo Use hitpoints of construction sites vs number of work parts as a guide.
        maxWorkParts += this.find(FIND_MY_CONSTRUCTION_SITES).length / 2;
    }

    if (this.isEvacuating()) {
        // Just spawn a small builder for keeping roads intact.
        maxWorkParts = 1;
        builderSize = 3;
    }

    if (numWorkParts < maxWorkParts) {
        memory.options.push({
            priority: 3,
            weight: 0.5,
            role: 'builder',
            size: builderSize,
        });
    }
};

Room.prototype.addExploitSpawnOptions = function () {
    if (_.size(this.exploits) == 0) {
        return;
    }

    var memory = this.memory.spawnQueue;
    for (let name in this.exploits) {
        this.exploits[name].addSpawnOptions(memory.options);
    }
};

Room.prototype.addBoostManagerSpawnOptions = function () {
    if (!this.boostManager) return;

    var memory = this.memory.spawnQueue;
    if (this.boostManager.needsSpawning()) {
        memory.options.push({
            priority: 4,
            weight: 1,
            role: 'boosts',
            roomName: this.name,
        });
    }
};

Room.prototype.addPowerSpawnOptions = function () {
    if (Memory.disablePowerHarvesting) {
      return;
    }

    if (!Memory.strategy || !Memory.strategy.power || !Memory.strategy.power.rooms) {
        return;
    }

    var memory = this.memory.spawnQueue;
    let myRoomName = this.name;

    for (let roomName in Memory.strategy.power.rooms) {
        let info = Memory.strategy.power.rooms[roomName];

        if (!info.isActive) continue;

        // @todo Determine supposed time until we crack open the power bank.
        // Then we can stop spawning attackers and spawn haulers instead.

        if (info.spawnRooms[myRoomName]) {
            let travelTime = 50 * info.spawnRooms[myRoomName].distance;

            let timeToKill = info.hits / info.dps;

            // We're assigned to spawn creeps for this power gathering operation!
            let powerHarvesters = _.filter(Game.creepsByRole['harvester.power'] || [], function (creep) {
                if (creep.memory.sourceRoom == myRoomName && creep.memory.targetRoom == roomName && !creep.memory.isHealer) {
                    if ((creep.ticksToLive || CREEP_LIFE_TIME) >= CREEP_SPAWN_TIME * MAX_CREEP_SIZE + travelTime) {
                        return true;
                    }
                }
                return false;
            });
            let powerHealers = _.filter(Game.creepsByRole['harvester.power'] || [], function (creep) {
                if (creep.memory.sourceRoom == myRoomName && creep.memory.targetRoom == roomName && creep.memory.isHealer) {
                    if ((creep.ticksToLive || CREEP_LIFE_TIME) >= CREEP_SPAWN_TIME * MAX_CREEP_SIZE + travelTime) {
                        return true;
                    }
                }
                return false;
            });

            if (powerHarvesters.length < 2 && powerHarvesters.length <= powerHealers.length && timeToKill > 0) {
                memory.options.push({
                    priority: 4,
                    weight: 1,
                    role: 'harvester.power',
                    targetRoom: roomName,
                });
            }

            // Also spawn healers.
            if (powerHealers.length < 2 && powerHarvesters.length >= powerHealers.length && timeToKill > 0) {
                memory.options.push({
                    priority: 4,
                    weight: 1,
                    role: 'harvester.power',
                    targetRoom: roomName,
                    isHealer: true,
                });
            }

            if (timeToKill < CREEP_SPAWN_TIME * MAX_CREEP_SIZE + CREEP_LIFE_TIME * 1 / 3) {
                // Time to spawn haulers!
                let powerHaulers = _.filter(Game.creepsByRole['hauler.power'] || [], (creep) => creep.memory.targetRoom == roomName);
                let totalCapacity = 0;
                for (let i in powerHaulers) {
                    totalCapacity += powerHaulers[i].carryCapacity;
                }

                if (totalCapacity < info.amount * 1.2) {
                    memory.options.push({
                        priority: 4,
                        weight: 0.5,
                        role: 'hauler.power',
                        targetRoom: roomName,
                    });
                }
            }
        }
    }
};

Room.prototype.addDismantlerSpawnOptions = function () {
    if (this.isEvacuating()) return;

    var memory = this.memory.spawnQueue;

    let flags = _.filter(Game.flags, (flag) => flag.name.startsWith('Dismantle:' + this.name));
    if (flags.length > 0) {
        // @todo Check if there is enough dismantlers per room with flags in it.
        let flag = flags[0];
        let numDismantlers = _.filter(Game.creepsByRole.dismantler || [], (creep) => creep.memory.targetRoom == flag.pos.roomName && creep.memory.sourceRoom == this.name).length;

        if (numDismantlers < 1) {
            memory.options.push({
                priority: 4,
                weight: 0,
                role: 'dismantler',
                targetRoom: flag.pos.roomName,
            });
        }
    }

    if (this.roomPlanner.needsDismantling()) {
        let numDismantlers = _.filter(this.creepsByRole.dismantler || [], (creep) => creep.memory.targetRoom == this.name && creep.memory.sourceRoom == this.name).length;

        if (numDismantlers < 1) {
            memory.options.push({
                priority: 3,
                weight: 0,
                role: 'dismantler',
                targetRoom: this.name,
            });
        }
    }
};

/**
 * Spawns creeps in a room whenever needed.
 */
Room.prototype.manageSpawns = function () {
    if (!this.controller || !this.controller.my) {
        return;
    }

    if (!this.memory.throttleOffset) this.memory.throttleOffset = utilities.getThrottleOffset();

    if (utilities.throttle(this.memory.throttleOffset, 0, Memory.throttleInfo.bucket.warning)) {
        return;
    }

    // If the new spawn code is trying to spawn something, give it priority.
    if (this.manageSpawnsPriority()) {
        return;
    }

    var roomSpawns = _.filter(Game.spawns, (spawn) => spawn.pos.roomName == this.name);

    var room = this;

    // Gather some information.
    // @todo This could be done on script startup and partially kept in room memory.
    var mineralHarvesters = this.creepsByRole['harvester.minerals'] || [];
    var minerals = room.find(FIND_MINERALS, {
        filter: (mineral) => {
            var extractors = mineral.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: (structure) => structure.structureType == STRUCTURE_EXTRACTOR && structure.pos.x == mineral.pos.x && structure.pos.y == mineral.pos.y
            });

            if (extractors.length > 0) {
                return true;
            }
            return false;
        }
    });

    var spawnerUsed = false;
    for (let spawnID in roomSpawns) {
        if (spawnerUsed) break;

        var spawn = roomSpawns[spawnID];

        // @todo Stop spawning for a bit if creeps are queued for renewing.

        // If spawning was just finished, scan the room again to assign creeps.
        if (spawn.spawning) {
            spawn.memory.wasSpawning = true;
            continue;
        }
        else if (spawn.memory.wasSpawning) {
            spawn.memory.wasSpawning = false;
            room.scan();
        }
        spawnerUsed = true;

        var numSources = 0;

        {
            // Harvest minerals.
            if (mineralHarvesters.length < minerals.length && minerals[0].mineralAmount > 0 && !this.isFullOnMinerals()) {
                // We assume there is always at most one mineral deposit in a room.
                if (spawn.spawnMineralHarvester(minerals[0])) {
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

                    var brawlers = _.filter(Game.creepsByRole.brawler || [], (creep) => {
                        if (creep.memory.storage == utilities.encodePosition(position) && creep.memory.target == utilities.encodePosition(flag.pos)) {
                            return true;
                        }
                        return false;
                    });

                    if (!brawlers || brawlers.length < 1) {
                        if (spawn.spawnBrawler(flag.pos)) {
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

                if (!Memory.squads || !Memory.squads[squadName]) continue;

                //console.log('Spawning squad', squadName);
                // @todo Initialize Game.squads in main loop and use that.
                var squad = Game.squads[squadName];
                if (squad.spawnUnit(spawn)) {
                    return true;
                }
            }

            // If possible, we could claim new rooms!
            var numRooms = _.size(_.filter(Game.rooms, (room) => room.controller && room.controller.my));
            var maxRooms = Game.gcl.level;
            var claimFlags = _.filter(Game.flags, (flag) => flag.name.startsWith('ClaimRoom'));
            if (/*numRooms < maxRooms &&*/ claimFlags.length > 0) {
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
                        var claimers = _.filter(Game.creepsByRole.claimer || [], (creep) => {
                            if (creep.memory.mission == 'claim' && creep.memory.target == utilities.encodePosition(flag.pos)) {
                                return true;
                            }
                            return false;
                        });

                        if (!claimers || claimers.length < 1) {
                            if (spawn.spawnClaimer(flag.pos, 'claim')) {
                                console.log('sending new claimer to', utilities.encodePosition(flag.pos));
                                return true;
                            }
                        }
                    }
                }
            }
            if (claimFlags.length > 0) {
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
                            var builders = _.filter(Game.creepsByRole['builder.remote'] || [], (creep) => {
                                if (creep.memory.target == utilities.encodePosition(flag.pos)) {
                                    return true;
                                }
                                return false;
                            });

                            if (!builders || builders.length < maxRemoteBuilders) {
                                if (spawn.spawnRemoteBuilder(flag.pos)) {
                                    console.log('sending new remote builder to', utilities.encodePosition(flag.pos));
                                    return true;
                                }
                            }
                        }
                    }
                }
            }

            // We've got nothing to do, how about some remote harvesting?
            let harvestPositions = [];
            var harvestFlags = _.filter(Game.flags, (flag) => flag.name.startsWith('HarvestRemote'));

            for (var i in harvestFlags) {
                let flag = harvestFlags[i];
                let isSpecificFlag = false;

                // Make sure not to harvest from wrong rooms.
                if (flag.name.startsWith('HarvestRemote:')) {
                    let parts = flag.name.split(':');
                    if (parts[1] && parts[1] != spawn.pos.roomName) {
                        continue;
                    }
                    isSpecificFlag = true;
                }

                if (Game.map.getRoomLinearDistance(spawn.pos.roomName, flag.pos.roomName) > 1 && !isSpecificFlag) {
                    continue;
                }

                harvestPositions.push(flag.pos);
            }

            let remoteHarvestTargets = spawn.room.getRemoteHarvestTargets();
            for (var i in remoteHarvestTargets) {
                let roomName = remoteHarvestTargets[i].roomName;
                if (!Memory.rooms[roomName] || !Memory.rooms[roomName].intel) continue;
                let sources = Memory.rooms[roomName].intel.sources;
                for (let j in sources) {
                    if (typeof sources[j] == 'object') {
                        harvestPositions.push(new RoomPosition(sources[j].x, sources[j].y, roomName));
                    }
                }
            }

            for (var i in harvestPositions) {
                let pos = harvestPositions[i];
                let isSpecificFlag = false;

                // First of all, if it's not safe, send a bruiser.
                var roomMemory = Memory.rooms[pos.roomName];
                if (roomMemory && roomMemory.enemies && !roomMemory.enemies.safe) {
                    var position = spawn.pos;
                    if (spawn.room.storage) {
                        position = spawn.room.storage.pos;
                    }

                    // Since we just want a brawler in the room - not one per remoteharvest source - generalize target position.
                    var brawlPosition = new RoomPosition(25, 25, pos.roomName);

                    var maxBrawlers = 1;
                    var brawlers = _.filter(Game.creepsByRole.brawler || [], (creep) => {
                        if (creep.memory.storage == utilities.encodePosition(position) && creep.memory.target == utilities.encodePosition(brawlPosition)) {
                            return true;
                        }
                        return false;
                    });

                    if (!brawlers || brawlers.length < maxBrawlers) {
                        let result = spawn.spawnBrawler(brawlPosition, 4, utilities.encodePosition(pos));
                        if (result) {
                            //console.log('Brawler spawning to defend room ' + pos.roomName);

                            if (result) {
                                let position = utilities.encodePosition(pos);
                                console.log('Spawning new brawler to defend', position, ':', result);

                                let cost = 0;
                                for (let partType in Memory.creeps[result].body) {
                                    cost += BODYPART_COST[partType] * Memory.creeps[result].body[partType];
                                }
                                stats.addRemoteHarvestDefenseCost(spawn.room.name, position, cost);
                            }
                        }
                        // Do not continue trying to spawn other creeps when defense is needed.
                        return true;
                    }
                }

                // If it's safe or brawler is sent, start harvesting.
                var doSpawn = true;
                var flagPosition = utilities.encodePosition(pos);
                var position = spawn.pos;
                if (spawn.room.storage) {
                    position = spawn.room.storage.pos;
                }
                position = utilities.encodePosition(position);

                // Cache path when possible.
                try {
                    utilities.precalculatePaths(spawn.room, pos);
                }
                catch (e) {
                    console.log('Error in pathfinding:', e);
                    console.log(e.stack);
                }

                if (spawn.room.memory.remoteHarvesting && spawn.room.memory.remoteHarvesting[flagPosition]) {
                    var memory = spawn.room.memory.remoteHarvesting[flagPosition];
                    doSpawn = false;

                    memory.harvesters = [];
                    var haulCount = 0;
                    var harvesters = _.filter(Game.creepsByRole['harvester.remote'] || [], (creep) => creep.memory.storage == position && creep.memory.source == flagPosition);
                    var haulers = _.filter(Game.creepsByRole.hauler || [], (creep) => creep.memory.storage == position && creep.memory.source == flagPosition);

                    var maxRemoteHarvesters = 1;
                    var maxRemoteHaulers = 0;
                    if (memory.revenue > 0 || memory.hasContainer) {
                        // @todo Calculate number of needed haulers.
                        maxRemoteHaulers = 1;

                        if (Game.rooms[pos.roomName]) {
                            let room = Game.rooms[pos.roomName];
                            if (room.controller && (room.controller.my || (room.controller.reservation && room.controller.reservation.username == utilities.getUsername()))) {
                                maxRemoteHaulers = 2;
                            }
                        }
                    }

                    var maxCarryParts = null;
                    var travelTime = null;
                    var travelTimeSpawn = null;
                    if (memory.travelTime) {
                        travelTime = memory.travelTime;
                        travelTimeSpawn = memory.travelTime;
                    }
                    if (memory.cachedPath && memory.cachedPath.path) {
                        // Path length is more accurate than observed travel time, because it's calculated between storage and source, not spawn and source.
                        travelTime = memory.cachedPath.path.length;

                        if (!travelTimeSpawn) {
                            travelTimeSpawn = memory.cachedPath.path.length;
                        }
                    }
                    if (travelTime) {
                        maxCarryParts = Math.ceil(travelTime * SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME / CARRY_CAPACITY);

                        // If we cannot create big enough haulers (yet), create more of them!
                        let bodyWeights = spawn.getHaulerBodyWeights();
                        let maxHauler = utilities.generateCreepBody(bodyWeights, spawn.room.energyCapacityAvailable, {carry: maxCarryParts});
                        let carryCount = 0;
                        for (let j in maxHauler) {
                            if (maxHauler[j] == CARRY) {
                                carryCount++;
                            }
                        }

                        let multiplier = Math.min(maxCarryParts / carryCount, 3);
                        maxRemoteHaulers *= multiplier;
                    }

                    for (var j in harvesters) {
                        var creep = harvesters[j];
                        if (!travelTimeSpawn || creep.ticksToLive > travelTimeSpawn || creep.ticksToLive > 500 || creep.spawning) {
                            memory.harvesters.push(creep.id);
                        }
                    }

                    if (memory.harvesters.length < maxRemoteHarvesters) {
                        doSpawn = true;
                    }

                    for (var j in haulers) {
                        let creep = haulers[j];
                        if (!travelTimeSpawn || creep.ticksToLive > travelTimeSpawn || creep.ticksToLive > 500 || creep.spawning) {
                            haulCount++;
                        }
                    }

                    if (haulCount < maxRemoteHaulers && !doSpawn) {
                        // Spawn hauler if necessary, but not if harvester is needed first.
                        let result = spawn.spawnHauler(pos, maxCarryParts);
                        if (result) {
                            var cost = 0;
                            for (var part in Memory.creeps[result].body) {
                                var count = Memory.creeps[result].body[part];
                                cost += BODYPART_COST[part] * count;
                            }
                            stats.addRemoteHarvestCost(spawn.room.name, utilities.encodePosition(pos), cost);
                            return true;
                        }
                    }
                }

                if (doSpawn) {
                    let result = spawn.spawnRemoteHarvester(pos);
                    if (result) {
                        let cost = 0;
                        for (let part in Memory.creeps[result].body) {
                            let count = Memory.creeps[result].body[part];
                            cost += BODYPART_COST[part] * count;
                        }
                        stats.addRemoteHarvestCost(spawn.room.name, utilities.encodePosition(pos), cost);
                        return true;
                    }
                }
            }

            // No harvester spawned? How about some claimers?
            // @todo Move from flags to positions for automation.
            var reservePositions = [];
            var reserveFlags = _.filter(Game.flags, (flag) => flag.name.startsWith('ReserveRoom'));
            for (var i in reserveFlags) {
                var flag = reserveFlags[i];
                let isSpecificFlag = false;

                // Make sure not to harvest from wrong rooms.
                if (flag.name.startsWith('ReserveRoom:')) {
                    let parts = flag.name.split(':');
                    if (parts[1] && parts[1] != spawn.pos.roomName) {
                        continue;
                    }
                    isSpecificFlag = true;
                }

                if (Game.map.getRoomLinearDistance(spawn.pos.roomName, flag.pos.roomName) > 1 && !isSpecificFlag) {
                    continue;
                }

                reservePositions.push(flag.pos);
            }

            for (var i in remoteHarvestTargets) {
                let roomName = remoteHarvestTargets[i].roomName;
                if (!Memory.rooms[roomName] || !Memory.rooms[roomName].intel) continue;
                let intel = Memory.rooms[roomName].intel;
                if (!intel.structures || !intel.structures[STRUCTURE_CONTROLLER]) continue;

                let controllers = intel.structures[STRUCTURE_CONTROLLER];
                for (let j in controllers) {
                    reservePositions.push(new RoomPosition(controllers[j].x, controllers[j].y, roomName));
                }
            }

            for (var i in reservePositions) {
                let pos = reservePositions[i];

                // Cache path when possible.
                try {
                    utilities.precalculatePaths(spawn.room, pos);
                }
                catch (e) {
                    console.log('Error in pathfinding:', e);
                    console.log(e.stack);
                }

                let doSpawn = false;

                var claimerIds = [];
                var claimers = _.filter(Game.creepsByRole.claimer || [], (creep) => creep.memory.mission == 'reserve');
                var maxClaimers = 1;

                for (var j in claimers) {
                    var creep = claimers[j];

                    if (creep.memory.target == utilities.encodePosition(pos)) {
                        claimerIds.push(creep.id);
                    }
                }
                if (claimerIds.length < maxClaimers) {
                    doSpawn = true;
                }
                if (Memory.rooms[pos.roomName]
                    && Memory.rooms[pos.roomName].lastClaim
                    && Memory.rooms[pos.roomName].lastClaim.value + (Memory.rooms[pos.roomName].lastClaim.time - Game.time) > CONTROLLER_RESERVE_MAX * 0.5
                ) {
                    doSpawn = false;
                }

                if (doSpawn) {
                    let result = spawn.spawnClaimer(pos, 'reserve');

                    if (result) {
                        // Add cost to a random harvest flag in the room.
                        // @todo Now that we don't always use flags, find a better way to associate.
                        let harvestFlags = _.filter(Game.flags, (flag2) => {
                            if (flag2.name.startsWith('HarvestRemote') && flag2.pos.roomName == pos.roomName) {
                                // Make sure not to harvest from wrong rooms.
                                if (flag2.name.startsWith('HarvestRemote:')) {
                                    let parts = flag2.name.split(':');
                                    if (parts[1] && parts[1] != spawn.pos.roomName) {
                                        return false;
                                    }
                                }
                                return true;
                            }
                            return false;
                        });

                        if (harvestFlags.length > 0) {
                            let cost = 0;
                            for (let part in Memory.creeps[result].body) {
                                let count = Memory.creeps[result].body[part];
                                cost += BODYPART_COST[part] * count;
                            }

                            stats.addRemoteHarvestCost(spawn.room.name, utilities.encodePosition(_.sample(harvestFlags).pos), cost);
                        }
                        return true;
                    }
                }
            }

            // Last but not least: Scouts.
            let found = false;
            for (let i in Game.creepsByRole.scout || []) {
                if (Game.creepsByRole.scout[i].memory.origin == spawn.pos.roomName) {
                    found = true;
                    break;
                }
            }
            if (!found && spawn.room.needsScout()) {
                if (spawn.spawnScout()) {
                    return true;
                }
            }
        }

        // Let only one spawner spawn each tick to prevent confusion.
        break;
    }
};


StructureSpawn.prototype.spawnRemoteHarvester = function (targetPosition) {
    var bodyWeights = {move: 0.5, work: 0.2, carry: 0.3};
    var maxParts = {work: 3};
    // Use less work parts if room is not reserved yet.
    if (Game.rooms[targetPosition.roomName]) {
        let room = Game.rooms[targetPosition.roomName];
        if (room.controller && (room.controller.my || (room.controller.reservation && room.controller.reservation.username == utilities.getUsername()))) {
            maxParts.work = 6;
        }
    }
    // @todo Also use high number of work parts if road still needs to be built.

    // Use less move parts if a road has already been established.
    if (this.room.memory.remoteHarvesting && this.room.memory.remoteHarvesting[utilities.encodePosition(targetPosition)] && this.room.memory.remoteHarvesting[utilities.encodePosition(targetPosition)].revenue > 0) {
        // @todo Use calculated max size like normal harvesters.
        bodyWeights = {move: 0.35, work: 0.55, carry: 0.1};
    }

    var position = this.pos;
    if (this.room.storage) {
        position = this.room.storage.pos;
    }

    return this.createManagedCreep({
        role: 'harvester.remote',
        bodyWeights: bodyWeights,
        maxParts: maxParts,
        memory: {
            storage: utilities.encodePosition(position),
            source: utilities.encodePosition(targetPosition),
        },
    });
};

StructureSpawn.prototype.spawnBrawler = function (targetPosition, maxAttackParts, pathTarget) {
    var maxParts = null;
    if (maxAttackParts) {
        maxParts = {attack: maxAttackParts};
    }

    var position = this.pos;
    if (this.room.storage) {
        position = this.room.storage.pos;
    }

    return this.createManagedCreep({
        role: 'brawler',
        bodyWeights: {move: 0.5, attack: 0.3, heal: 0.2},
        maxParts: maxParts,
        memory: {
            storage: utilities.encodePosition(position),
            target: utilities.encodePosition(targetPosition),
            pathTarget: pathTarget,
        },
    });
};

StructureSpawn.prototype.spawnClaimer = function (targetPosition, mission) {
    var setCost = BODYPART_COST[CLAIM] + BODYPART_COST[MOVE];

    var numSets = Math.floor(this.room.energyCapacityAvailable / setCost);
    if (numSets < 2) return false;

    if (numSets > 5) {
        numSets = 5;
    }
    var body = _.fill(Array(numSets), CLAIM).concat(_.fill(Array(numSets), MOVE));

    return this.createManagedCreep({
        role: 'claimer',
        body: body,
        memory: {
            target: utilities.encodePosition(targetPosition),
            mission: mission,
        },
    });
};

StructureSpawn.prototype.getHaulerBodyWeights = function () {
    return {move: 0.35, work: 0.05, carry: 0.6};
}

/**
 * Spawns a new hauler.
 */
StructureSpawn.prototype.spawnHauler = function (targetPosition, maxCarryParts) {
    var maxParts = null;
    if (maxCarryParts) {
        maxParts = {carry: maxCarryParts};
    }

    var position = this.pos;
    if (this.room.storage) {
        position = this.room.storage.pos;
    }

    var bodyWeights = this.getHaulerBodyWeights();

    return this.createManagedCreep({
        role: 'hauler',
        bodyWeights: bodyWeights,
        maxParts: maxParts,
        memory: {
            storage: utilities.encodePosition(position),
            source: utilities.encodePosition(targetPosition),
        },
    });
};

/**
 * Spawns a new dismantler.
 */
StructureSpawn.prototype.spawnDismantler = function (targetRoom) {
    var boosts = null;
    if (this.room.canSpawnBoostedCreeps()) {
        var availableBoosts = this.room.getAvailableBoosts('dismantle');
        var bestBoost;
        for (let resourceType in availableBoosts || []) {
            if (availableBoosts[resourceType].available >= 50) {
                if (!bestBoost || availableBoosts[resourceType].effect > availableBoosts[bestBoost].effect) {
                    bestBoost = resourceType;
                }
            }
        }

        if (bestBoost) {
            boosts = {
                work: bestBoost,
            };
        }
    }

    return this.createManagedCreep({
        role: 'dismantler',
        bodyWeights: {move: 0.35, work: 0.65},
        memory: {
            sourceRoom: this.pos.roomName,
            targetRoom: targetRoom,
        },
    });
};

/**
 * Spawns a new harvester.
 */
StructureSpawn.prototype.spawnHarvester = function (force, maxSize, sourceID) {
    var minCost = null;
    if (force) {
        minCost = 200;
    }

    return this.createManagedCreep({
        role: 'harvester',
        bodyWeights: {move: 0.1, work: 0.7, carry: 0.2},
        minCost: minCost,
        maxParts: maxSize ? {work: maxSize} : null,
        memory: {
            singleRoom: this.pos.roomName,
            fixedSource: sourceID,
        },
    });
};

/**
 * Spawns a new power harvester.
 */
StructureSpawn.prototype.spawnPowerHarvester = function (targetRoom, isHealer) {
    var bodyParts = [];
    var functionalPart = ATTACK;
    if (isHealer) {
        functionalPart = HEAL;
    }
    for (let i = 0; i < MAX_CREEP_SIZE; i++) {
        // First half is all move parts.
        if (i < MAX_CREEP_SIZE / 2) {
            bodyParts.push(MOVE);
            continue;
        }

        // The rest is functional parts.
        bodyParts.push(functionalPart);
    }

    return this.createManagedCreep({
        role: 'harvester.power',
        body: bodyParts,
        memory: {
            sourceRoom: this.pos.roomName,
            targetRoom: targetRoom,
            isHealer: isHealer,
        },
    });
}

/**
 * Spawns a new power hauler.
 */
StructureSpawn.prototype.spawnPowerHauler = function (targetRoom) {
    return this.createManagedCreep({
        role: 'hauler.power',
        bodyWeights: {move: 0.35, carry: 0.65},
        memory: {
            sourceRoom: this.pos.roomName,
            targetRoom: targetRoom,
        },
    });
}

/**
 * Spawns a new mineral harvester.
 */
StructureSpawn.prototype.spawnMineralHarvester = function (source) {
    var boosts = null;
    if (this.room.canSpawnBoostedCreeps()) {
        var availableBoosts = this.room.getAvailableBoosts('harvest');
        var bestBoost;
        for (let resourceType in availableBoosts || []) {
            if (availableBoosts[resourceType].available >= 50) {
                if (!bestBoost || availableBoosts[resourceType].effect > availableBoosts[bestBoost].effect) {
                    bestBoost = resourceType;
                }
            }
        }

        if (bestBoost) {
            boosts = {
                work: bestBoost,
            };
        }
    }

    return this.createManagedCreep({
        role: 'harvester.minerals',
        bodyWeights: {move: 0.35, work: 0.3, carry: 0.35},
        boosts: boosts,
        memory: {
            singleRoom: this.pos.roomName,
            fixedMineralSource: source.id,
        },
    });
};

/**
 * Spawns a new repairer.
 */
/*StructureSpawn.prototype.spawnRepairer = function (size) {
    var maxParts = {work: 5};
    if (size) {
        maxParts.work = size;
    }

    return this.createManagedCreep({
        role: 'repairer',
        bodyWeights: {move: 0.35, work: 0.35, carry: 0.3},
        maxParts: maxParts,
        memory: {
            singleRoom: this.pos.roomName,
        },
    });
};//*/

/**
 * Spawns a new repairer.
 */
StructureSpawn.prototype.spawnBuilder = function (size) {
    var maxParts = {};
    if (size) {
        maxParts.work = size;
    }

    var boosts = null;
    if (this.room.canSpawnBoostedCreeps()) {
        var availableBoosts = this.room.getAvailableBoosts('repair');
        var bestBoost;
        for (let resourceType in availableBoosts || []) {
            if (availableBoosts[resourceType].available >= maxParts.work) {
                if (!bestBoost || availableBoosts[resourceType].effect > availableBoosts[bestBoost].effect) {
                    bestBoost = resourceType;
                }
            }
        }

        if (bestBoost) {
            boosts = {
                work: bestBoost,
            };
        }
    }

    return this.createManagedCreep({
        role: 'builder',
        bodyWeights: {move: 0.35, work: 0.35, carry: 0.3},
        maxParts: maxParts,
        boosts: boosts,
        memory: {
            singleRoom: this.pos.roomName,
        },
    });
};

/**
 * Spawns a new transporter.
 */
StructureSpawn.prototype.spawnTransporter = function (force, size) {
    var minCost = null;
    if (force) {
        minCost = 250;
    }

    var maxParts = {carry: 8};
    if (size) {
        maxParts.carry = size;
    }

    return this.createManagedCreep({
        role: 'transporter',
        bodyWeights: {move: 0.35, carry: 0.65},
        maxParts: maxParts,
        minCost: minCost,
        memory: {
            singleRoom: this.pos.roomName,
        },
    });
};

/**
 * Spawns a new upgrader.
 */
/*StructureSpawn.prototype.spawnUpgrader = function () {
    var bodyWeights = {move: 0.35, work: 0.3, carry: 0.35};
    if (this.room.memory.controllerContainer || this.room.memory.controllerLink) {
        bodyWeights = {move: 0.2, work: 0.75, carry: 0.05};
    }

    return this.createManagedCreep({
        role: 'upgrader',
        bodyWeights: bodyWeights,
        maxParts: {work: 15},
        memory: {
            singleRoom: this.pos.roomName,
        },
    });
};//*/

/**
 * Spawns a new upgrader.
 */
StructureSpawn.prototype.spawnUpgrader = function () {
    var bodyWeights = {move: 0.35, work: 0.3, carry: 0.35};
    if (this.room.memory.controllerContainer || this.room.memory.controllerLink) {
        bodyWeights = {move: 0.2, work: 0.75, carry: 0.05};
    }

    var boosts = null;
    if (this.room.canSpawnBoostedCreeps()) {
        var availableBoosts = this.room.getAvailableBoosts('upgradeController');
        var bestBoost;
        for (let resourceType in availableBoosts || []) {
            if (availableBoosts[resourceType].available >= CONTROLLER_MAX_UPGRADE_PER_TICK) {
                if (!bestBoost || availableBoosts[resourceType].effect > availableBoosts[bestBoost].effect) {
                    bestBoost = resourceType;
                }
            }
        }

        if (bestBoost) {
            boosts = {
                work: bestBoost,
            };
        }
    }

    return this.createManagedCreep({
        role: 'upgrader',
        bodyWeights: bodyWeights,
        boosts: boosts,
        maxParts: {work: CONTROLLER_MAX_UPGRADE_PER_TICK},
        memory: {
            singleRoom: this.pos.roomName,
        },
    });
};

/**
 * Spawns a new remote builder.
 */
StructureSpawn.prototype.spawnRemoteBuilder = function (targetPosition) {
    return this.createManagedCreep({
        role: 'builder.remote',
        bodyWeights: {move: 0.5, carry: 0.3, work: 0.2},
        memory: {
            target: utilities.encodePosition(targetPosition),
            starting: true,
        },
    });
};

/**
 * Spawns a new scout.
 */
StructureSpawn.prototype.spawnScout = function () {
    return this.createManagedCreep({
        role: 'scout',
        body: [MOVE],
        memory: {
            origin: this.pos.roomName,
        },
    });
};

/**
 * Handles logic for spawning creeps in rooms, and spawning creeps to go
 * outside of these rooms.
 */
var spawnManager = {

    /**
     * Manages spawning logic for all spawns.
     */
    manageSpawns: function () {
        for (var roomName in Game.rooms) {
            var room = Game.rooms[roomName];
            if (room.controller && room.controller.my) {
                room.manageSpawns();
            }
        }
    },

};

module.exports = spawnManager;
