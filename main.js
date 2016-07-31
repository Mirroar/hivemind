var creepGeneral = require('creep.general');
var gameState = require('game.state');
var roleBuilder = require('role.builder');
var roleDefender = require('role.defender');
var roleHarvester = require('role.harvester');
var roleRepairer = require('role.repairer');
var roleTransporter = require('role.transporter');
var roleUpgrader = require('role.upgrader');
var structureManager = require('structure.manager');
var utilities = require('utilities');

// @todo Decide when it is a good idea to send out harvesters to adjacent unclaimend tiles.
// @todo Add a healer to defender squads, or spawn one when creeps are injured.

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
            var maxTransporters = 2;
            if (spawner.room.memory && spawner.room.memory.sources) {
                maxHarvesters = 0;
                maxTransporters = 1;
                for (var id in spawner.room.memory.sources) {
                    maxHarvesters += spawner.room.memory.sources[id].maxHarvesters;
                    maxTransporters++;
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
                roleHarvester.spawn(spawner, true);
            }
            else if (numTransporters < 1) {
                // @todo Spawn only if there is at least one container / storage.
                roleTransporter.spawn(spawner, true);
            }
            if (numHarvesters < maxHarvesters) {
                roleHarvester.spawn(spawner);
            }
            else if (numTransporters < maxTransporters) {
                // @todo Spawn only if there is at least one container / storage.
                roleTransporter.spawn(spawner);
            }
            else if (upgraders.length < maxUpgraders) {
                roleUpgrader.spawn(spawner);
            }
            else if (builders.length < maxBuilders) {
                roleBuilder.spawn(spawner);
            }
            else if (repairers.length < 3) {
                // @todo Determine total decay in room and how many worker parts that wohle need.
                roleRepairer.spawn(spawner);
            }
            else if (defenders.length < maxDefenders) {
                // @todo Decide how many defenders are needed depending on number / energy levels of towers, RCL, wall status.
                roleDefender.spawn(spawner);
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
                            return structure.pos.getRangeTo(tower) <= 5 || structure.hits < 1000 && tower.energy > tower.energyCapacity * 0.7;
                        }
                        if (structure.structureType == STRUCTURE_RAMPART) {
                            return (structure.pos.getRangeTo(tower) <= 5 || structure.hits < 1000) && tower.energy > tower.energyCapacity * 0.7;
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
