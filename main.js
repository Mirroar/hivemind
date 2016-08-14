// Screeps profiler stuff
var profiler = require('screeps-profiler');

require('manager.source');
require('pathfinding');
require('role.brawler');
require('role.builder');
require('role.claimer');
require('role.harvester');
require('role.harvester.remote');
require('role.hauler');
require('role.repairer');
require('role.scout');
require('role.transporter');
require('role.upgrader');

var creepGeneral = require('creep.general');
var gameState = require('game.state');
var intelManager = require('manager.intel');
var roleplay = require('manager.roleplay');
var roleRemoteBuilder = require('role.builder.remote');
var spawnManager = require('manager.spawn');
var stats = require('stats');
var structureManager = require('manager.structure');
var utilities = require('utilities');

var Bay = require('manager.bay');
var Exploit = require('manager.exploit');
var Squad = require('manager.squad');

// @todo Decide when it is a good idea to send out harvesters to adjacent unclaimend tiles.
// @todo Add a healer to defender squads, or spawn one when creeps are injured.
// @todo spawn new buildings where reasonable when controller upgrades or stuff gets destroyed.

// @todo Do not send any remote harvesters or claimers until enemies in a room should have expired. Maybe scout from time to time.
// @todo make unarmed creeps run from hostiles.

// @todo Make sure creeps that are supposed to stay in their room do that, go back to their room if exited, and pathfind within the room only.

// @todo add try / catch block to main loops so that one broken routine doesn't stop the whole colony from working.

// @todo Harvest source keeper rooms. Inspiration: E36N34

// @todo Cache building info and CostMatrix objects when scanning rooms in intel manager.

// @todo Buff creeps with mineral compounds when there are labs near a spawn.

// @todo Spawn creeps using "sequences" where more control is needed.

/**
 * Use the new pathfinder to move within a certain range of a target.
 */
Creep.prototype.moveToRange = function (target, range) {
    PathFinder.use(true);
    let pos = target;
    if (target.pos) {
        pos = target.pos;
    }
    this.moveTo({pos: pos, range: range}, {
        maxRooms: 1,
    });
    PathFinder.use(false);
};

/**
 * Runs a creeps logic depending on role and other factors.
 */
Creep.prototype.runLogic = function() {
    var creep = this;

    if (this.memory.singleRoom && this.pos.roomName != this.memory.singleRoom) {
        // @todo Keep in room.
    }

    try {
        if (creep.memory.role == 'harvester') {
            creep.runHarvesterLogic();
        }
        else if (creep.memory.role == 'harvester.minerals') {
            creep.runHarvesterLogic();
        }
        else if (creep.memory.role == 'upgrader') {
            creep.runUpgraderLogic();
        }
        else if (creep.memory.role == 'builder') {
            if (creep.memory.tempRole || !creep.runBuilderLogic()) {
                creep.memory.tempRole = 'upgrader';
                creep.runUpgraderLogic();
            }
        }
        else if (creep.memory.role == 'repairer') {
            if (creep.memory.tempRole || !creep.runRepairerLogic()) {
                creep.memory.tempRole = 'upgrader';
                creep.runUpgraderLogic();
            }
        }
        else if (creep.memory.role == 'transporter') {
            creep.runTransporterLogic();
        }
        else if (creep.memory.role == 'harvester.remote') {
            creep.runRemoteHarvesterLogic();
        }
        else if (creep.memory.role == 'claimer') {
            creep.runClaimerLogic();
        }
        else if (creep.memory.role == 'hauler') {
            creep.runHaulerLogic();
        }
        else if (creep.memory.role == 'brawler') {
            creep.runBrawlerLogic();
        }
        else if (creep.memory.role == 'builder.remote') {
            roleRemoteBuilder.run(creep);
        }
        else if (creep.memory.role == 'scout') {
            creep.runScoutLogic();
        }
    }
    catch (e) {
        console.log('Error when managing creep', creep.name, ':', e);
        console.log(e.stack);
    }
};

/**
 * Adds some additional data to room objects.
 */
Room.prototype.enhanceData = function () {
    this.sources = [];

    if (!this.creeps) {
        this.creeps = {};
        this.creepsByRole = {};
    }

    if (this.memory.intel) {
        let intel = this.memory.intel;

        if (intel.sources) {
            for (let i in intel.sources) {
                let source = Game.getObjectById(intel.sources[i]);
                this.sources.push(source);
                source.enhanceData();
            }
        }
    }

    this.bays = {};
    let flags = this.find(FIND_FLAGS, {
        filter: (flag) => flag.name.startsWith('Bay:')
    });
    for (let i in flags) {
        try {
            this.bays[flags[i].name] = new Bay(flags[i].name);
        }
        catch (e) {
            console.log('Error when initializing Bays:', e);
            console.log(e.stack);
        }
    }
};

// Enable profiling of all methods in Game object protitypes defined up to now.
profiler.enable();

var main = {

    /**
     * Manages logic for all creeps.
     */
    manageCreeps: function () {
        for (var name in Game.creeps) {
            var creep = Game.creeps[name];

            if (creep.spawning) {
                continue;
            }

            creep.runLogic();
        }
    },

    /**
     * Manages logic for structures.
     */
    manageStructures: function () {
        if (Game.time % 1000 == 337) {
            for (var name in Game.rooms) {
                structureManager.checkRoads(Game.rooms[name]);
            }
        }
    },

    /**
     * Manages logic for all towers.
     */
    manageTowers: function () {
        // Handle towers.
        var towers = _.filter(Game.structures, function (structure) {
            return (structure.structureType == STRUCTURE_TOWER) && structure.energy > 0;
        });
        for (var i in towers) {
            // @todo Try / catch.
            towers[i].runLogic();
        }
    },

    /**
     * Manages logic for all links.
     */
    manageLinks: function () {
        for (var roomName in Game.rooms) {
            var room = Game.rooms[roomName];

            // Pump energy into upgrade controller link when possible to keep the upgrades flowing.
            if (room.memory.controllerLink) {
                var controllerLink = Game.getObjectById(room.memory.controllerLink);
                if (controllerLink && controllerLink.energy <= controllerLink.energyCapacity * 0.5) {
                    var upgradeControllerSupplied = false;

                    if (room.memory.sources) {
                        for (var id in room.memory.sources) {
                            if (!room.memory.sources[id].targetLink) continue;

                            // We have a link next to a source. Good.
                            var link = Game.getObjectById(room.memory.sources[id].targetLink);
                            if (!link) continue;

                            if (link.energy >= link.energyCapacity * 0.5 && link.cooldown <= 0) {
                                link.transferEnergy(controllerLink);
                                upgradeControllerSupplied = true;
                            }
                        }
                    }

                    if (!upgradeControllerSupplied && room.memory.storageLink) {
                        var storageLink = Game.getObjectById(room.memory.storageLink);
                        if (storageLink) {
                            if (storageLink.energy >= storageLink.energyCapacity * 0.5 && storageLink.cooldown <= 0) {
                                storageLink.transferEnergy(controllerLink);
                                upgradeControllerSupplied = true;
                            }
                        }
                    }
                }
            }
        }
    },

    /**
     * Records when hostiles were last seen in a room.
     */
    checkRoomSecurity: function () {
        for (var roomName in Game.rooms) {
            var room = Game.rooms[roomName];

            var hostiles = room.find(FIND_HOSTILE_CREEPS);
            var parts = {};
            var lastSeen = room.memory.enemies && room.memory.enemies.lastSeen || 0;
            var safe = true;

            if (hostiles.length > 0) {
                // Count body parts for strength estimation.
                for (var j in hostiles) {
                    if (hostiles[j].isDangerous()) {
                        safe = false;
                        lastSeen = Game.time;
                    }
                    for (var k in hostiles[j].body) {
                        let type = hostiles[j].body[k].type;
                        if (!parts[type]) {
                            parts[type] = 0;
                        }
                        parts[type]++;
                    }
                }
            }

            room.memory.enemies = {
                parts: parts,
                lastSeen: lastSeen,
                safe: safe,
            };
        }
    },

    /**
     * Main game loop.
     */
    loop: function () {
        profiler.wrap(function () {

            if (Game.time % 10 == 0 && Game.cpu.bucket < 9800) {
                console.log('Bucket:', Game.cpu.bucket);
            }

            var time = Game.cpu.getUsed();

            // Clear gameState cache variable, since it seems to persist between Ticks from time to time.
            gameState.clearCache();

            // Add data to global Game object.
            Game.squads = {};
            for (var squadName in Memory.squads) {
                Game.squads[squadName] = new Squad(squadName);
            }

            // Cache creeps per room and role.
            // @todo Probably move to Creep.prototype.enhanceData().
            Game.creepsByRole = {};
            for (let creepName in Game.creeps) {
                let creep = Game.creeps[creepName];
                let role = creep.memory.role;

                if (!Game.creepsByRole[role]) {
                    Game.creepsByRole[role] = {};
                }
                Game.creepsByRole[role][creepName] = creep;

                let room = creep.room;
                if (!room.creeps) {
                    room.creeps = {};
                    room.creepsByRole = {};
                }
                room.creeps[creepName] = creep;
                if (!room.creepsByRole[role]) {
                    room.creepsByRole[role] = {};
                }
                room.creepsByRole[role][creepName] = creep;
            }

            // Add data to room objects.
            for (let roomName in Game.rooms) {
                Game.rooms[roomName].enhanceData();
            }

            // Always place this memory cleaning code at the very top of your main loop!
            for (var name in Memory.creeps) {
                if (!Game.creeps[name]) {
                    //console.log(Memory.creeps[name].role, name, 'has died. :(');
                    delete Memory.creeps[name];
                }
            }

            // Make sure memory structure is available.
            if (!Memory.timers) {
                Memory.timers = {};
            }

            var initCPUUsage = Game.cpu.getUsed() - time;
            time = Game.cpu.getUsed();

            spawnManager.manageSpawns();

            var spawnCPUUsage = Game.cpu.getUsed() - time;
            time = Game.cpu.getUsed();

            main.manageStructures();

            var linksCPUUsage = Game.cpu.getUsed() - time;
            time = Game.cpu.getUsed();

            main.manageCreeps();

            var creepsCPUUsage = Game.cpu.getUsed() - time;
            time = Game.cpu.getUsed();

            main.manageTowers();

            var towersCPUUsage = Game.cpu.getUsed() - time;
            time = Game.cpu.getUsed();

            main.manageLinks();

            var linksCPUUsage = Game.cpu.getUsed() - time;
            time = Game.cpu.getUsed();

            try {
                main.checkRoomSecurity();
            }
            catch (e) {
                console.log('error in manageResources:');
                console.log(e.stack);
            }

            if (Game.time % 10 == 1) {
                try {
                    structureManager.manageResources();
                }
                catch (e) {
                    console.log('error in manageResources:');
                    console.log(e.stack);
                }
            }

            for (let roomName in Game.rooms) {
                try {
                    Game.rooms[roomName].manageLabs();
                }
                catch (e) {
                    console.log('error in manageLabs:');
                    console.log(e.stack);
                }
            }

            try {
                intelManager.scout();
            }
            catch (e) {
                console.log('Error in intelManager.scout:', e);
            }

            try {
                roleplay.roomSongs();
            }
            catch (e) {
                console.log('Error in roomSongs:', e);
            }

            var statsCPUUsage = Game.cpu.getUsed() - time;
            let totalTime = Game.cpu.getUsed();

            // Grafana stats
            if (Memory.stats == undefined) {
              Memory.stats = {};
            }

            var rooms = Game.rooms;
            var spawns = Game.spawns;
            var resources = structureManager.getRoomResourceStates();
            for (let roomKey in rooms) {
                let room = Game.rooms[roomKey];
                var isMyRoom = (room.controller ? room.controller.my : 0);
                if (isMyRoom) {
                    Memory.stats['room.' + room.name + '.myRoom'] = 1;
                    Memory.stats['room.' + room.name + '.energyAvailable'] = room.energyAvailable;
                    Memory.stats['room.' + room.name + '.energyCapacityAvailable'] = room.energyCapacityAvailable;
                    Memory.stats['room.' + room.name + '.controllerProgress'] = room.controller.progress;
                    Memory.stats['room.' + room.name + '.controllerProgressTotal'] = room.controller.progressTotal;
                    var stored = 0;
                    var storedTotal = 0;

                    if (room.storage) {
                        stored = room.storage.store[RESOURCE_ENERGY];
                        storedTotal = room.storage.storeCapacity;
                    }
                    else {
                        var storagePosition = room.getStorageLocation();
                        var spot = room.find(FIND_DROPPED_ENERGY, {
                            filter: (resource) => {
                                if (resource.resourceType == RESOURCE_ENERGY) {
                                    if (storagePosition && resource.pos.x == storagePosition.x && resource.pos.y == storagePosition.y) {
                                        return true;
                                    }
                                }
                                return false;
                            }
                        });

                        if (spot.length > 0) {
                            stored = spot[0].amount;
                        }
                        else {
                            stored = 0;
                        }
                        storedTotal = 0;
                    }

                    if (room.terminal) {
                        stored += room.terminal.store[RESOURCE_ENERGY];
                        storedTotal += room.terminal.storeCapacity;
                    }

                    Memory.stats['room.' + room.name + '.storedEnergy'] = stored;

                    // Log all resources.
                    if (resources[room.name]) {
                        for (var resourceType in resources[room.name].totalResources) {
                            Memory.stats['room.' + room.name + '.resources.' + resourceType] = resources[room.name].totalResources[resourceType];
                        }
                    }

                    // Log spawn activity.
                    let roomSpawns = _.filter(spawns, (spawn) => spawn.room.name == room.name);
                    for (let spawnKey in roomSpawns) {
                        let spawn = roomSpawns[spawnKey];
                        Memory.stats['room.' + room.name + '.spawns.' + spawn.name + '.spawning'] = spawn.spawning && 1 || 0;
                    }

                    // Log remote harvest revenue.
                    var harvestMemory = room.memory.remoteHarvesting;
                    if (harvestMemory) {
                        for (var target in harvestMemory) {
                            if (Game.time % 10000 == 0) {
                                stats.clearRemoteHarvestStats(room.name, target);
                            }

                            var harvestFlags = _.filter(Game.flags, (flag) => {
                                if (flag.name.startsWith('HarvestRemote') && utilities.encodePosition(flag.pos) == target) {
                                    if (flag.name.startsWith('HarvestRemote:')) {
                                        let parts = flag.name.split(':');
                                        if (parts[1] && parts[1] != room.name) {
                                            return false;
                                        }
                                    }
                                    return true;
                                }
                                return false;
                            });

                            if (harvestFlags.length > 0) {
                                Memory.stats['room.' + room.name + '.remoteHarvesting.' + target + '.revenue'] = harvestMemory[target].revenue;
                                Memory.stats['room.' + room.name + '.remoteHarvesting.' + target + '.creepCost'] = -harvestMemory[target].creepCost;
                                Memory.stats['room.' + room.name + '.remoteHarvesting.' + target + '.buildCost'] = -harvestMemory[target].buildCost;
                                Memory.stats['room.' + room.name + '.remoteHarvesting.' + target + '.defenseCost'] = -harvestMemory[target].defenseCost;
                                // Total does not include buildCost, because we get that "for free" from the remote energy source.
                                Memory.stats['room.' + room.name + '.remoteHarvesting.' + target + '.total'] = harvestMemory[target].revenue - harvestMemory[target].creepCost - harvestMemory[target].defenseCost;
                            }
                        }
                    }
                }
                else {
                    Memory.stats['room.' + room.name + '.myRoom'] = undefined;
                }
            }
            Memory.stats['gcl.progress'] = Game.gcl.progress;
            Memory.stats['gcl.progressTotal'] = Game.gcl.progressTotal;
            Memory.stats['gcl.level'] = Game.gcl.level;
            for (let spawnKey in spawns) {
                let spawn = spawns[spawnKey];
                Memory.stats['spawn.' + spawn.name + '.defenderIndex'] = spawn.memory['defenderIndex'];
            }
            let creepCounts = {};
            for (let role in Game.creepsByRole) {
                Memory.stats['creeps.count.' + role] = _.size(Game.creepsByRole[role]);
            }

            Memory.stats['cpu.CreepManagers'] = spawnCPUUsage;
            Memory.stats['cpu.Towers'] = towersCPUUsage;
            //Memory.stats['cpu.Links'] = linksRunning;
            //Memory.stats['cpu.SetupRoles'] = roleSetup;
            Memory.stats['cpu.Creeps'] = creepsCPUUsage;
            //Memory.stats['cpu.SumProfiling'] = sumOfProfiller;
            Memory.stats['cpu.Start'] = initCPUUsage;
            Memory.stats['cpu.bucket'] = Game.cpu.bucket;
            Memory.stats['cpu.limit'] = Game.cpu.limit;
            Memory.stats['cpu.stats'] = Game.cpu.getUsed() - totalTime;
            Memory.stats['cpu.getUsed'] = Game.cpu.getUsed();

            time = Game.cpu.getUsed();
        });
    }

};

module.exports = main;
