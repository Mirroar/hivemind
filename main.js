// Screeps profiler stuff
var statsConsole = require('statsConsole');

var creepGeneral = require('creep.general');
var gameState = require('game.state');
var intelManager = require('manager.intel');
var roleBrawler = require('role.brawler');
var roleBuilder = require('role.builder');
var roleClaimer = require('role.claimer');
var roleHarvester = require('role.harvester');
var roleHauler = require('role.hauler');
var roleplay = require('manager.roleplay');
var roleRemoteBuilder = require('role.builder.remote');
var roleRemoteHarvester = require('role.harvester.remote');
var roleRepairer = require('role.repairer');
var roleScout = require('role.scout');
var roleTransporter = require('role.transporter');
var roleUpgrader = require('role.upgrader');
var spawnManager = require('manager.spawn');
var structureManager = require('structure.manager');
var utilities = require('utilities');

var Squad = require('manager.squad');

// @todo Decide when it is a good idea to send out harvesters to adjacent unclaimend tiles.
// @todo Add a healer to defender squads, or spawn one when creeps are injured.
// @todo spawn new buildings where reasonable when controller upgrades or stuff gets destroyed.

// @todo Do not send any remote harvesters or claimers until enemies in a room should have expired. Maybe scout from time to time.

// @todo Make sure creeps that are supposed to stay in their room do that, go back to their room if exited, and pathfind within the room only.

// @todo add try / catch block to main loops so that one broken routine doesn't stop the whole colony from working.

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

            try {
                if (creep.memory.role == 'harvester') {
                    roleHarvester.run(creep);
                }
                else if (creep.memory.role == 'harvester.minerals') {
                    roleHarvester.run(creep);
                }
                else if (creep.memory.role == 'upgrader') {
                    roleUpgrader.run(creep);
                }
                else if (creep.memory.role == 'builder') {
                    if (creep.memory.tempRole || !roleBuilder.run(creep)) {
                        creep.memory.tempRole = 'upgrader';
                        roleUpgrader.run(creep);
                    }
                }
                else if (creep.memory.role == 'repairer') {
                    if (creep.memory.tempRole || !roleRepairer.run(creep)) {
                        creep.memory.tempRole = 'upgrader';
                        roleUpgrader.run(creep);
                    }
                }
                else if (creep.memory.role == 'transporter') {
                    roleTransporter.run(creep);
                }
                else if (creep.memory.role == 'harvester.remote') {
                    roleRemoteHarvester.run(creep);
                }
                else if (creep.memory.role == 'claimer') {
                    roleClaimer.run(creep);
                }
                else if (creep.memory.role == 'hauler') {
                    roleHauler.run(creep);
                }
                else if (creep.memory.role == 'brawler') {
                    roleBrawler.run(creep);
                }
                else if (creep.memory.role == 'builder.remote') {
                    roleRemoteBuilder.run(creep);
                }
                else if (creep.memory.role == 'scout') {
                    roleScout.run(creep);
                }
            }
            catch (e) {
                console.log('Error when managing creep', creep.name, ':', e);
            }
        }
    },

    /**
     * Manages logic for structures.
     */
    manageStructures: function () {
        if (!Memory.timers.checkRoads || Memory.timers.checkRoads + 1000 < Game.time) {
            Memory.timers.checkRoads = Game.time;
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
            var tower = towers[i];
            if (tower) {
                // Emergency repairs.
                var closestDamagedStructure = tower.pos.findClosestByRange(FIND_STRUCTURES, {
                    filter: (structure) => {
                        if (structure.structureType == STRUCTURE_WALL) {
                            return ((structure.pos.getRangeTo(tower) <= 5 && structure.hits < 10000) || structure.hits < 1000) && tower.energy > tower.energyCapacity * 0.7;
                        }
                        if (structure.structureType == STRUCTURE_RAMPART) {
                            return ((structure.pos.getRangeTo(tower) <= 5 && structure.hits < 10000) || structure.hits < 1000) && tower.energy > tower.energyCapacity * 0.7;
                        }
                        return (structure.hits < structure.hitsMax - TOWER_POWER_REPAIR) && (structure.hits < structure.hitsMax * 0.2);
                    }
                });
                if (closestDamagedStructure) {
                    tower.repair(closestDamagedStructure);
                }

                // Attack enemies.
                var closestHostileHealer = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
                    filter: (creep) => {
                        for (var i in creep.body) {
                            if (creep.body[i].type == HEAL && creep.body[i].hits > 0) {
                                return true;
                            }
                        }
                        return false;
                    }
                });
                var closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
                if (closestHostileHealer) {
                    tower.attack(closestHostileHealer);
                }
                else if (closestHostile) {
                    tower.attack(closestHostile);
                }

                // Heal friendlies.
                var damaged = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
                    filter: (creep) => creep.hits < creep.hitsMax
                });
                if (damaged) {
                    tower.heal(damaged);
                }
            }
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
            if (hostiles && hostiles.length > 0) {
                // Count body parts for strength estimation.
                var parts = {};
                for (var j in hostiles) {
                    for (var k in hostiles[j].body) {
                        if (!parts[hostiles[j].body[k].type]) {
                            parts[hostiles[j].body[k].type] = 0;
                        }
                        parts[hostiles[j].body[k].type]++;
                    }
                }

                room.memory.enemies = {
                    parts: parts,
                    lastSeen: Game.time,
                    safe: false,
                };
            }
            else {
                // Declare room safe again.
                if (!room.memory.enemies) {
                    room.memory.enemies = {
                        parts: {},
                        lastSeen: 0,
                        safe: true,
                    };
                }
                room.memory.enemies.safe = true;
            }
        }
    },

    /**
     * Main game loop.
     */
    loop: function () {
        var time = Game.cpu.getUsed();

        // Clear gameState cache variable, since it seems to persist between Ticks from time to time.
        gameState.clearCache();

        // Add data to global Game object.
        Game.squads = [];
        for (var squadName in Memory.squads) {
            Game.squads.push(new Squad(squadName));
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

        var CreepManagersCPUUsage = Game.cpu.getUsed() - time;
        time = Game.cpu.getUsed();

        main.manageStructures();

        var linksCPUUsage = Game.cpu.getUsed() - time;
        time = Game.cpu.getUsed();

        main.manageCreeps();

        var CreepsCPUUsage = Game.cpu.getUsed() - time;
        time = Game.cpu.getUsed();

        main.manageTowers();

        var towersCPUUsage = Game.cpu.getUsed() - time;
        time = Game.cpu.getUsed();

        main.manageLinks();

        var linksCPUUsage = Game.cpu.getUsed() - time;
        time = Game.cpu.getUsed();

        main.checkRoomSecurity();

        try {
            intelManager.scout();
        }
        catch (e) {
            statsConsole.log('Error in intelManager.scout:', e);
        }

        try {
            roleplay.roomSongs();
        }
        catch (e) {
            statsConsole.log('Error in roomSongs:', e);
        }

        let totalTime = Game.cpu.getUsed();
        // sample data format ["Name for Stat", variableForStat]
        let myStats = [
            ["Creep Managers", CreepManagersCPUUsage],
            ["Towers", towersCPUUsage],
            ["Links", linksCPUUsage],
            //["Setup Roles", SetupRolesCPUUsage],
            ["Creeps", CreepsCPUUsage],
            ["Init", initCPUUsage],
            //["Stats", statsCPUUsage],
            ["Total", totalTime],
        ];

        statsConsole.run(myStats); // Run Stats collection

        var statsCPUUsage = Game.cpu.getUsed() - time;
        time = Game.cpu.getUsed();

        if (totalTime > Game.cpu.limit) {
            statsConsole.log("Tick: " + Game.time + "  CPU OVERRUN: " + Game.cpu.getUsed().toFixed(2) + "  Bucket:" + Game.cpu.bucket, 5);
        }
        if ((Game.time % 5) === 0) {
            console.log(statsConsole.displayHistogram());
            console.log(statsConsole.displayStats());
            console.log(statsConsole.displayLogs());
            //console.log(statsConsole.displayMaps()); // Don't use as it will consume ~30-40 CPU
            totalTime = (Game.cpu.getUsed() - totalTime);
            console.log("Time to Draw: " + totalTime.toFixed(2));
        }
    }

};

module.exports = main;
