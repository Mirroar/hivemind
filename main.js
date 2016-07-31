var roleHarvester   = require('role.harvester');
var roleUpgrader    = require('role.upgrader');
var roleBuilder     = require('role.builder');
var roleRepairer    = require('role.repairer');
var roleDefender    = require('role.defender');
var roleTransporter = require('role.transporter');

var creepGeneral = require('creep.general');

var utilities = require('utilities');

// @todo Decide when it is a good idea to send out harvesters to adjacent unclaimend tiles.

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
            var harvesters = _.filter(Game.creeps, (creep) => creep.memory.role == 'harvester');
            var builders = _.filter(Game.creeps, (creep) => creep.memory.role == 'builder');
            var upgraders = _.filter(Game.creeps, (creep) => creep.memory.role == 'upgrader');
            var repairers = _.filter(Game.creeps, (creep) => creep.memory.role == 'repairer');
            var defenders = _.filter(Game.creeps, (creep) => creep.memory.role == 'defender');
            var transporters = _.filter(Game.creeps, (creep) => creep.memory.role == 'transporter');

            var maxHarvesters = 3;
            if (spawner.room.memory && spawner.room.memory.sources) {
                maxHarvesters = 0;
                for (var id in spawner.room.memory.sources) {
                    maxHarvesters += spawner.room.memory.sources[id].maxHarvesters;
                }
            }
            if (harvesters.length < 1) {
                roleHarvester.spawn(spawner, true);
            }
            else if (transporters.length < 1) {
                // @todo Spawn only if there is at least one container / storage.
                roleTransporter.spawn(spawner, true);
            }
            if (harvesters.length < maxHarvesters) {
                roleHarvester.spawn(spawner);
            }
            else if (transporters.length < 2) {
                // @todo Spawn only if there is at least one container / storage.
                roleTransporter.spawn(spawner);
            }
            else if (upgraders.length < 3) {
                roleUpgrader.spawn(spawner);
            }
            else if (builders.length < 3) {
                roleBuilder.spawn(spawner);
            }
            else if (repairers.length < 3) {
                roleRepairer.spawn(spawner);
            }
            else if (defenders.length < 1) {
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
                            return structure.pos.getRangeTo(tower) <= 5 && tower.energy > tower.energyCapacity * 0.7;
                        }
                        if (structure.structureType == STRUCTURE_RAMPART) {
                            return structure.pos.getRangeTo(tower) <= 5 && tower.energy > tower.energyCapacity * 0.7;
                        }
                        return (structure.hits < structure.hitsMax - TOWER_POWER_REPAIR) && (structure.hits < structure.hitsMax * 0.2);
                    }
                });
                if (closestDamagedStructure) {
                    tower.repair(closestDamagedStructure);
                }

                var closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
                if (closestHostile) {
                    tower.attack(closestHostile);
                }
            }
        }
    },

    /**
     * Main game loop.
     */
    loop: function () {
        // Always place this memory cleaning code at the very top of your main loop!
        for (var name in Memory.creeps) {
            if (!Game.creeps[name]) {
                console.log(Memory.creeps[name].role, name, 'has died. :(');
                delete Memory.creeps[name];
            }
        }

        main.manageSpawns();
        main.manageCreeps();
        main.manageTowers();
    }

};

module.exports = main;
