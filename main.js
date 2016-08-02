// Screeps profiler stuff
var profiler = require('screeps-profiler');

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
var structureManager = require('manager.structure');
var utilities = require('utilities');

var Bay = require('manager.bay');
var Squad = require('manager.squad');

// @todo Decide when it is a good idea to send out harvesters to adjacent unclaimend tiles.
// @todo Add a healer to defender squads, or spawn one when creeps are injured.
// @todo spawn new buildings where reasonable when controller upgrades or stuff gets destroyed.

// @todo Do not send any remote harvesters or claimers until enemies in a room should have expired. Maybe scout from time to time.

// @todo Make sure creeps that are supposed to stay in their room do that, go back to their room if exited, and pathfind within the room only.

// @todo add try / catch block to main loops so that one broken routine doesn't stop the whole colony from working.

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

Room.prototype.enhanceData = function () {
    this.sources = [];

    if (this.memory.intel) {
        let intel = this.memory.intel;

        if (intel.sources) {
            for (let i in intel.sources) {
                this.sources.push(Game.getObjectById(intel.sources[i]));
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
            Game.squads = [];
            for (var squadName in Memory.squads) {
                Game.squads.push(new Squad(squadName));
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

            let totalTime = Game.cpu.getUsed();
            var statsCPUUsage = Game.cpu.getUsed() - time;

            // Grafana stats
            if (Memory.stats == undefined) {
              Memory.stats = {};
            }

            var rooms = Game.rooms;
            var spawns = Game.spawns;
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
                        storedTotal = room.storage.storeCapacity[RESOURCE_ENERGY];
                    }
                    else {
                        stored = 0;
                        storedTotal = 0;
                    }

                    Memory.stats['room.' + room.name + '.storedEnergy'] = stored;
                }
                else {
                    Memory.stats['room.' + room.name + '.myRoom'] = undefined;
                }
            }
            Memory.stats['gcl.progress'] = Game.gcl.progress;
            Memory.stats['gcl.progressTotal'] = Game.gcl.progressTotal;
            Memory.stats['gcl.level'] = Game.gcl.level;
            for (let spawnKey in spawns) {
                let spawn = Game.spawns[spawnKey];
                Memory.stats['spawn.' + spawn.name + '.defenderIndex'] = spawn.memory['defenderIndex'];
            }
            let creepCounts = {};
            for (let i in Game.creeps) {
                let creep = Game.creeps[i];
                let role = creep.memory.role.replace('.', '_');
                creepCounts[role] = (creepCounts[role] || 0) + 1;
            }
            for (let role in creepCounts) {
                Memory.stats['creeps.count.' + role] = creepCounts[role];
            }

            Memory.stats['cpu.CreepManagers'] = spawnCPUUsage;
            Memory.stats['cpu.Towers'] = towersCPUUsage;
            //Memory.stats['cpu.Links'] = linksRunning;
            //Memory.stats['cpu.SetupRoles'] = roleSetup;
            Memory.stats['cpu.Creeps'] = creepsCPUUsage;
            //Memory.stats['cpu.SumProfiling'] = sumOfProfiller;
            //Memory.stats['cpu.Start'] = startOfMain;
            Memory.stats['cpu.bucket'] = Game.cpu.bucket;
            Memory.stats['cpu.limit'] = Game.cpu.limit;
            //Memory.stats['cpu.stats'] = Game.cpu.getUsed() - lastTick;
            Memory.stats['cpu.getUsed'] = Game.cpu.getUsed();

            time = Game.cpu.getUsed();
        });
    }

};

module.exports = main;
