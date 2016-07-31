var creepGeneral = require('creep.general');
var gameState = require('game.state');
var roleBrawler = require('role.brawler');
var roleBuilder = require('role.builder');
var roleClaimer = require('role.claimer');
var roleDefender = require('role.defender');
var roleHarvester = require('role.harvester');
var roleHauler = require('role.hauler');
var roleRemoteBuilder = require('role.builder.remote');
var roleRemoteHarvester = require('role.harvester.remote');
var roleRepairer = require('role.repairer');
var roleTransporter = require('role.transporter');
var roleUpgrader = require('role.upgrader');
var structureManager = require('structure.manager');
var utilities = require('utilities');

// @todo Decide when it is a good idea to send out harvesters to adjacent unclaimend tiles.
// @todo Add a healer to defender squads, or spawn one when creeps are injured.
// @todo Move spawning logic into own file.

// @todo Do not send any remote harvesters or claimers until enemies in a room should have expired. Maybe scout from time to time.

// @todo Make sure creeps that are supposed to stay in their room do that, go back to their room if exited, and pathfind within the room only.

var main = {

    /**
     * Manages spawning logic for all spawners.
     */
    manageSpawns: function() {
        for (var name in Game.spawns) {
            // @todo Manage on a per-room basis, if possible.
            var spawner = Game.spawns[name];
            var room = Game.rooms[spawner.pos.roomName];

            // If spawning was just finished, scan the room again to assign creeps.
            if (spawner.spawning) {
                spawner.memory.wasSpawning = true;
            }
            else if (spawner.memory.wasSpawning) {
                spawner.memory.wasSpawning = false;
                utilities.scanRoom(spawner.room);
            }

            // Spawn new creeps.
            var builders = _.filter(Game.creeps, (creep) => creep.memory.role == 'builder' && creep.pos.roomName == spawner.pos.roomName);
            var defenders = _.filter(Game.creeps, (creep) => creep.memory.role == 'defender' && creep.pos.roomName == spawner.pos.roomName);
            var numHarvesters = gameState.getNumHarvesters(spawner.pos.roomName);
            var repairers = _.filter(Game.creeps, (creep) => creep.memory.role == 'repairer' && creep.pos.roomName == spawner.pos.roomName);
            var numTransporters = gameState.getNumTransporters(spawner.pos.roomName);
            var upgraders = _.filter(Game.creeps, (creep) => creep.memory.role == 'upgrader' && creep.pos.roomName == spawner.pos.roomName);

            var numSources = 0;
            var spawnHarvester = false;
            var maxHarvesters = 3;
            var maxTransporters = 2; // @todo Find a good way to gauge needed number of transporters by measuring distances.
            var maxHarvesterSize;
            if (spawner.room.memory && spawner.room.memory.sources) {
                numSources = _.size(spawner.room.memory.sources);
                maxHarvesters = 0;
                maxTransporters = 2 + 2 * numSources;
                for (var id in spawner.room.memory.sources) {
                    maxHarvesters += spawner.room.memory.sources[id].maxHarvesters;

                    if (!maxHarvesterSize || maxHarvesterSize < spawner.room.memory.sources[id].maxWorkParts) {
                        maxHarvesterSize = spawner.room.memory.sources[id].maxWorkParts;
                    }

                    var totalWork = 0;
                    for (var i in spawner.room.memory.sources[id].harvesters) {
                        var harvester = Game.getObjectById(spawner.room.memory.sources[id].harvesters[i]);
                        if (harvester) {
                            totalWork += utilities.getBodyParts(harvester).work;
                        }
                    }

                    if (totalWork < spawner.room.memory.sources[id].maxWorkParts && spawner.room.memory.sources[id].harvesters.length < spawner.room.memory.sources[id].maxHarvesters) {
                        spawnHarvester = true;
                    }
                }
            }
            //console.log(room.name, spawner.pos.roomName, 'Harvesters:', numHarvesters, '/', maxHarvesters);
            //console.log(room.name, spawner.pos.roomName, 'Transporters:', numTransporters, '/', maxTransporters);

            var maxUpgraders = 0;
            if (spawner.room.controller.level <= 2) {
                maxUpgraders = 1 + numSources;
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
                    // @todo Make sure enough energy is brought by.
                    maxUpgraders = 2;
                }
            }
            if (maxUpgraders == 0 && spawner.room.controller.ticksToDowngrade < CONTROLLER_DOWNGRADE[spawner.room.controller.level] * 0.2) {
                console.log('trying to spawn upgrader because controller is close to downgrading', spawner.room.controller.ticksToDowngrade, '/', CONTROLLER_DOWNGRADE[spawner.room.controller.level]);
                // Even if no upgraders are needed, at least create one when the controller is getting close to being downgraded.
                maxUpgraders = 1;
            }

            // Only spawn an amount of builders befitting the amount of construction to be done.
            var maxBuilders = 0;
            var constructionSites = spawner.room.find(FIND_MY_CONSTRUCTION_SITES);
            if (constructionSites) {
                maxBuilders = Math.min(1 + numSources, Math.ceil(constructionSites.length / 5));
            }

            var maxDefenders = 0;
            // Don't need defenders if enemies have not been seen for a long time.
            // This is assuming we have a strong wall and can spawn defenders in time if needed.
            if (spawner.room.memory.enemies && spawner.room.memory.enemies.lastSeen > Game.time - 2000) {
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
            else if (spawnHarvester) {
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
            else if (repairers.length < 2) {
                // @todo Determine total decay in room and how many worker parts that would need.
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
                // Send forces to other rooms.
                var brawlFlags = _.filter(Game.flags, (flag) => {
                    if (flag.name.startsWith('Brawler@')) {
                        var parts = flag.name.match(/^([^@]*)@([^@]*)@/);
                        if (parts && parts[2] == spawner.pos.roomName) {
                            return true;
                        }
                    }
                });
                if (brawlFlags.length > 0) {
                    var position = spawner.pos;
                    if (spawner.room.storage) {
                        position = spawner.room.storage.pos;
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
                            if (roleBrawler.spawn(spawner, flag.pos)) {
                                //Game.notify('Brawler spawned to defend room ' + flag.pos.roomName);
                                return true;
                            }
                        }
                    }
                }

                // If possible, we could claim new rooms!
                var numRooms = _.size(_.filter(Game.rooms, (room) => room.controller.my));
                var maxRooms = Game.gcl.level;
                var claimFlags = _.filter(Game.flags, (flag) => flag.name.startsWith('ClaimRoom'));
                if (numRooms < maxRooms && claimFlags.length > 0) {
                    for (var i in claimFlags) {
                        var flag = claimFlags[i];

                        if (Game.rooms[flag.pos.roomName] && Game.rooms[flag.pos.roomName].controller.my) {
                            // Room is already claimed.
                            continue;
                        }

                        // @todo Make sure only the closest room spawns a claimer!
                        var claimers = _.filter(Game.creeps, (creep) => {
                            if (creep.memory.role == 'claimer') {
                                if (creep.memory.mission == 'claim' && creep.memory.target == utilities.encodePosition(flag.pos)) {
                                    return true;
                                }
                            }
                            return false;
                        });

                        if (!claimers || claimers.length < 1) {
                            if (roleClaimer.spawn(spawner, flag.pos, 'claim')) {
                                console.log('sending new claimer to', utilities.encodePosition(flag.pos));
                                return true;
                            }
                        }
                    }
                }
                else if (claimFlags.length > 0) {
                    // Check if there are rooms marked for claiming, that belong to us, but have no spawner yet.
                    for (var i in claimFlags) {
                        var flag = claimFlags[i];

                        if (Game.rooms[flag.pos.roomName] && Game.rooms[flag.pos.roomName].controller.my) {
                            // @todo Make sure only the closest room spawn builders!
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
                                if (roleRemoteBuilder.spawn(spawner, flag.pos)) {
                                    console.log('sending new remote builder to', utilities.encodePosition(flag.pos));
                                    return true;
                                }
                            }
                        }
                    }
                }

                // We've got nothing to do, how about some remote harvesting?
                var harvestFlags = _.filter(Game.flags, (flag) => flag.name.startsWith('HarvestRemote'));
                for (var i in harvestFlags) {
                    var flag = harvestFlags[i];
                    if (Game.map.getRoomLinearDistance(spawner.pos.roomName, flag.pos.roomName) == 1) {
                        // First of all, if it's not safe, send a bruiser.
                        var roomMemory = Memory.rooms[flag.pos.roomName];
                        if (roomMemory && roomMemory.enemies && !roomMemory.enemies.safe) {
                            var position = spawner.pos;
                            if (spawner.room.storage) {
                                position = spawner.room.storage.pos;
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
                                if (roleBrawler.spawn(spawner, flag.pos)) {
                                    //Game.notify('Brawler spawned to defend room ' + flag.pos.roomName);
                                    return true;
                                }
                            }
                        }

                        // If it's safe or brawler is sent, start harvesting.
                        var doSpawn = true;
                        if (spawner.room.memory.remoteHarvesting && spawner.room.memory.remoteHarvesting[flag.pos.roomName]) {
                            var memory = spawner.room.memory.remoteHarvesting[flag.pos.roomName];
                            doSpawn = false;

                            memory.harvesters = [];
                            var haulCount = 0;
                            var harvesters = _.filter(Game.creeps, (creep) => creep.memory.role == 'harvester.remote');
                            var haulers = _.filter(Game.creeps, (creep) => creep.memory.role == 'hauler');
                            var maxRemoteHarvesters = 1;
                            var maxRemoteHaulers = 0;
                            if (spawner.room.memory.remoteHarvesting[flag.pos.roomName].revenue > 0) {
                                // Road has been built, can now use multiple harvesters.
                                // maxRemoteHarvesters = flag.name.substring(13, 14) * 1;

                                // @todo Calculate number of needed haulers.
                                maxRemoteHaulers = 2;
                            }

                            var position = spawner.pos;
                            if (spawner.room.storage) {
                                position = spawner.room.storage.pos;
                            }
                            for (var j in harvesters) {
                                var creep = harvesters[j];
                                //console.log(creep.memory.storage, utilities.encodePosition(position), creep.memory.source, utilities.encodePosition(flag.pos));
                                // @todo Move into filter function.
                                if (creep.memory.storage == utilities.encodePosition(position) && creep.memory.source == utilities.encodePosition(flag.pos)) {
                                    if (!memory[creep.memory.source] || creep.ticksToLive > memory[creep.memory.source].travelTime) {
                                        memory.harvesters.push(creep.id);
                                    }
                                }
                            }
                            if (memory.harvesters.length < maxRemoteHarvesters) {
                                doSpawn = true;
                            }

                            for (var j in haulers) {
                                var creep = haulers[j];
                                //console.log(creep.memory.storage, utilities.encodePosition(position), creep.memory.source, utilities.encodePosition(flag.pos));
                                // @todo Move into filter function.
                                if (creep.memory.storage == utilities.encodePosition(position) && creep.memory.source == utilities.encodePosition(flag.pos)) {
                                    if (!memory[creep.memory.source] || creep.ticksToLive > memory[creep.memory.source].travelTime) {
                                        haulCount++;
                                    }
                                }
                            }
                            if (haulCount < maxRemoteHaulers) {
                                if (roleHauler.spawn(spawner, flag.pos)) {
                                    return true;
                                }
                            }
                        }

                        if (doSpawn) {
                            if (roleRemoteHarvester.spawn(spawner, flag.pos)) {
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
                    if (Game.map.getRoomLinearDistance(spawner.pos.roomName, flag.pos.roomName) == 1) {

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
                            if (roleClaimer.spawn(spawner, flag.pos, 'reserve')) {
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

            if (creep.spawning) {
                continue;
            }

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
     * Records when hostiles were last seen in a room.
     */
    checkRoomSecurity: function () {
        for (var i in Game.rooms) {
            var room = Game.rooms[i];

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
        main.checkRoomSecurity();
    }

};

module.exports = main;
