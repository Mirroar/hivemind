var creepGeneral = require('creep.general');
var gameState = require('game.state');
var roleBuilder = require('role.builder');
var roleDefender = require('role.defender');
var roleHarvester = require('role.harvester');
var roleRemoteHarvester = require('role.harvester.remote');
var roleRepairer = require('role.repairer');
var roleTransporter = require('role.transporter');
var roleUpgrader = require('role.upgrader');
var structureManager = require('structure.manager');
var utilities = require('utilities');

// @todo Decide when it is a good idea to send out harvesters to adjacent unclaimend tiles.
// @todo Add a healer to defender squads, or spawn one when creeps are injured.
// @todo Move spawning logic into own file.

var main = {

    /**
     * Manages spawning logic for all spawners.
     */
    manageSpawns: function() {
        for (var name in Game.spawns) {
            // @todo Manage on a per-room basis, if possible.
            var spawner = Game.spawns[name];

            // If spawning was just finished, scan the room again to assign creeps.
            if (spawner.spawning) {
                spawner.memory.wasSpawning = true;
            }
            else if (spawner.memory.wasSpawning) {
                spawner.memory.wasSpawning = false;
                utilities.scanRoom(spawner.room);
            }

            // Spawn new creeps.
            var builders = _.filter(Game.creeps, (creep) => creep.memory.role == 'builder');
            var defenders = _.filter(Game.creeps, (creep) => creep.memory.role == 'defender');
            var numHarvesters = gameState.getNumHarvesters();
            var repairers = _.filter(Game.creeps, (creep) => creep.memory.role == 'repairer');
            var numTransporters = gameState.getNumTransporters();
            var upgraders = _.filter(Game.creeps, (creep) => creep.memory.role == 'upgrader');

            var maxHarvesters = 3;
            var maxTransporters = 2; // @todo Find a good way to gauge needed number of transporters by measuring distances.
            var maxHarvesterSize;
            if (spawner.room.memory && spawner.room.memory.sources) {
                maxHarvesters = 0;
                maxTransporters = 2;
                for (var id in spawner.room.memory.sources) {
                    maxHarvesters += spawner.room.memory.sources[id].maxHarvesters;
                    maxTransporters += 2;

                    if (!maxHarvesterSize || maxHarvesterSize < spawner.room.memory.sources[id].maxWorkParts) {
                        maxHarvesterSize = spawner.room.memory.sources[id].maxWorkParts;
                    }
                }
            }
            //console.log('Harvesters:', numHarvesters, '/', maxHarvesters);
            //console.log('Transporters:', numTransporters, '/', maxTransporters);

            var maxUpgraders = 0;
            if (spawner.room.controller.level <= 2) {
                maxUpgraders = 3;
            }
            else {
                if (gameState.getStoredEnergy(spawner.room) < 5000) {
                    maxUpgraders = 0;
                }
                else if (gameState.getStoredEnergy(spawner.room) < 50000) {
                    maxUpgraders = 1;
                }
                else {
                    // @todo Have maximum depend on number of work parts.
                    maxUpgraders = 2;
                }
            }
            if (maxUpgraders == 0 && spawner.room.controller.ticksToDowngrade < CONTROLLER_DOWNGRADE[spawner.room.controller.level] * 0.2) {
                console.log('trying to spawn upgrader because controller is close to downgrading', spawner.room.controller.ticksToDowngrade, '/', CONTROLLER_DOWNGRADE[spawner.room.controller.level]);
                // Even if no upgraders are needed, at least create one when the controller is getting close to being downgraded.
                maxUpgraders = 1;
            }

            var maxBuilders = 0;
            var constructionSites = spawner.room.find(FIND_MY_CONSTRUCTION_SITES);
            if (constructionSites) {
                maxBuilders = Math.min(3, Math.ceil(constructionSites.length / 10));
            }

            var maxDefenders = 0;
            var flags = spawner.room.find(FIND_FLAGS, {
                filter: (flag) => flag.name.startsWith('Defend')
            });
            if (flags) {
                maxDefenders = flags.length;

                for (var i in flags) {
                    var flag = flags[i];

                    // Check if a defender is assigned.
                    var numAssigned = 0;
                    for (var j in defenders) {
                        var defender = defenders[j];

                        if (defender.memory.targetFlag && defender.memory.targetFlag == flag.name) {
                            if (numAssigned >= 1) {
                                // This one is too much, unassign.
                                defender.memory.targetFlag = null;
                            }
                            else {
                                numAssigned++;
                            }
                        }
                    }

                    // Assign defenders if needed.
                    if (numAssigned < 1) {
                        for (var j in defenders) {
                            var defender = defenders[j];

                            if (!defender.memory.targetFlag) {
                                numAssigned++;
                                defender.memory.targetFlag = flag.name;
                                if (numAssigned >= 1) {
                                    break;
                                }
                            }
                        }
                    }

                    // Unassign defenders if needed.
                }
            }

            if (numHarvesters < 1) {
                if (roleHarvester.spawn(spawner, true, maxHarvesterSize)) {
                    return true;
                }
            }
            else if (numTransporters < 1) {
                // @todo Spawn only if there is at least one container / storage.
                if (roleTransporter.spawn(spawner, true)) {
                    return true;
                }
            }
            else if (numHarvesters < maxHarvesters) {
                if (roleHarvester.spawn(spawner, false, maxHarvesterSize)) {
                    return true;
                }
            }
            else if (numTransporters < maxTransporters) {
                // @todo Spawn only if there is at least one container / storage.
                if (roleTransporter.spawn(spawner)) {
                    return true;
                }
            }
            else if (upgraders.length < maxUpgraders) {
                if (roleUpgrader.spawn(spawner)) {
                    return true;
                }
            }
            else if (builders.length < maxBuilders) {
                if (roleBuilder.spawn(spawner)) {
                    return true;
                }
            }
            else if (repairers.length < 3) {
                // @todo Determine total decay in room and how many worker parts that wohle need.
                if (roleRepairer.spawn(spawner)) {
                    return true;
                }
            }
            else if (defenders.length < maxDefenders) {
                // @todo Decide how many defenders are needed depending on number / energy levels of towers, RCL, wall status.
                if (roleDefender.spawn(spawner)) {
                    return true;
                }
            }
            else {
                // We've got nothing to do, how about some remote harvesting?
                var harvestFlags = _.filter(Game.flags, (flag) => flag.name.startsWith('HarvestRemote'));
                for (var i in harvestFlags) {
                    var flag = harvestFlags[i];
                    if (Game.map.getRoomLinearDistance(spawner.pos.roomName, flag.pos.roomName) == 1) {
                        var doSpawn = true;
                        if (spawner.room.memory.remoteHarvesting && spawner.room.memory.remoteHarvesting[flag.pos.roomName]) {
                            var memory = spawner.room.memory.remoteHarvesting[flag.pos.roomName];
                            doSpawn = false;

                            memory.harvesters = [];
                            var harvesters = _.filter(Game.creeps, (creep) => creep.memory.role == 'harvester.remote');
                            var maxRemoteHarvesters = 1;
                            if (spawner.room.memory.remoteHarvesting[flag.pos.roomName].revenue > 0) {
                                // Road has been built, can now use multiple harvesters.
                                maxRemoteHarvesters = flag.name.substring(13, 14) * 1;
                            }

                            for (var j in harvesters) {
                                var creep = harvesters[j];
                                //console.log(creep.memory.storage, utilities.encodePosition(spawner.room.storage.pos), creep.memory.source, utilities.encodePosition(flag.pos));
                                if (creep.memory.storage == utilities.encodePosition(spawner.room.storage.pos) && creep.memory.source == utilities.encodePosition(flag.pos)) {
                                    memory.harvesters.push(creep.id);
                                }
                            }
                            if (memory.harvesters.length < maxRemoteHarvesters) {
                                doSpawn = true;
                            }
                        }

                        if (doSpawn) {
                            if (roleRemoteHarvester.spawn(spawner, flag.pos)) {
                                return true;
                            }
                        }
                    }
                }
            }
        }
    },

    /**
     * Manages logic for all creeps.
     */
    manageCreeps: function () {
        for (var name in Game.creeps) {
            var creep = Game.creeps[name];

            // @todo Rewrite renewing code when there's reasonable use cases.
            /*if (harvesters.length >= maxHarvesters / 2 && utilities.energyStored(spawner.room) > 1000) {
                    // Other creeps do not get renewed when we're low on harvesters or energy, so we don't waste the resources that could be spent on more harvesters.
                if (creep.memory.role != 'harvester') {
                    // Harvesters do not get renewed, because they move back to spawn too slowly anyway.
                    if (creepGeneral.renew(creep, spawner)) {
                        continue;
                    }
                }
            }//*/

            if (creep.memory.role == 'harvester') {
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
            else if (creep.memory.role == 'defender') {
                roleDefender.run(creep);
            }
            else if (creep.memory.role == 'transporter') {
                roleTransporter.run(creep);
            }
            else if (creep.memory.role == 'harvester.remote') {
                roleRemoteHarvester.run(creep);
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
            }
        }
    },

    /**
     * Main game loop.
     */
    loop: function () {
        // Clear gameState cache variable, since it seems to persist between Ticks from time to time.
        gameState.clearCache();

        // Always place this memory cleaning code at the very top of your main loop!
        for (var name in Memory.creeps) {
            if (!Game.creeps[name]) {
                console.log(Memory.creeps[name].role, name, 'has died. :(');
                delete Memory.creeps[name];
            }
        }

        // Make sure memory structure is available.
        if (!Memory.timers) {
            Memory.timers = {};
        }

        main.manageSpawns();
        main.manageStructures();
        main.manageCreeps();
        main.manageTowers();
    }

};

module.exports = main;
