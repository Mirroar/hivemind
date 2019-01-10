var utilities = require('utilities');

var roleRemoteBuilder = {

    /** @param {Creep} creep **/
    run: function (creep) {
        if (creep.memory.starting) {
            if (_.sum(creep.carry) < creep.carryCapacity) {
                return creep.performGetEnergy();
            }
            delete creep.memory.starting;
        }

        if (!creep.memory.building && creep.memory.extraEnergyTarget) {
            if (_.sum(creep.carry) >= creep.carryCapacity) {
                delete creep.memory.extraEnergyTarget;
                return true;
            }

            let pos = utilities.decodePosition(creep.memory.extraEnergyTarget);
            if (creep.pos.getRangeTo(pos) > 1) {
                if (creep.moveTo(pos) == ERR_NO_PATH) {
                    delete creep.memory.extraEnergyTarget;
                }
            }
            else {
                let source = creep.pos.findClosestByRange(FIND_SOURCES);
                creep.harvest(source);
                if (source.energy <= 0) {
                    delete creep.memory.extraEnergyTarget;
                }
            }
            return true;
        }
        if (!creep.memory.extraEnergyTarget && creep.memory.sourceRoom) {
            if (creep.pos.roomName != creep.memory.sourceRoom) {
                creep.moveToRange(new RoomPosition(25, 25, creep.memory.sourceRoom), 5);
            }
            else {
                delete creep.memory.sourceRoom;
            }
            return true;
        }

        var targetPosition = utilities.decodePosition(creep.memory.target);
        if (targetPosition.roomName != creep.pos.roomName) {
            creep.moveToRange(targetPosition, 5);
            return true;
        }

        if (creep.memory.building && creep.carry.energy == 0) {
            creep.memory.building = false;
            delete creep.memory.buildTarget;
            delete creep.memory.repairTarget;
            delete creep.memory.tempRole;
            delete creep.memory.upgrading;
        }
        else if (!creep.memory.building && creep.carry.energy == creep.carryCapacity) {
            creep.memory.building = true;
            delete creep.memory.resourceTarget;
            delete creep.memory.tempRole;
        }

        if (creep.memory.building) {
            // Try and prevent controller downgrades.
            if ((creep.room.controller && creep.room.controller.level < 2) || creep.room.controller.my && creep.room.controller.ticksToDowngrade < 500) creep.memory.upgrading = true;

            if (creep.room.controller.level == 0) {
                creep.memory.upgrading = false;
            }

            if (!creep.memory.upgrading) {
                // Check for claim flags.
                var claimFlags = creep.room.find(FIND_FLAGS, {
                    filter: (flag) => flag.name.startsWith('ClaimRoom')
                });
                if (claimFlags && claimFlags.length > 0) {
                    // Check if room has a spawner by now.
                    var spawners = creep.room.find(FIND_STRUCTURES, {
                        filter: (structure) => structure.structureType == STRUCTURE_SPAWN
                    });

                    if (!spawners || spawners.length <= 0) {
                        // Check if room has a spawner construction site by now.
                        var spawners = creep.room.find(FIND_CONSTRUCTION_SITES, {
                            filter: (site) => site.structureType == STRUCTURE_SPAWN
                        });

                        if (!spawners || spawners.length <= 0) {
                            // Create construction site for spawner.
                            claimFlags[0].pos.createConstructionSite(STRUCTURE_SPAWN);
                        }
                    }
                    else {
                        // Spawner exists, claim flag can be removed.
                        claimFlags[0].remove();
                    }
                }

                // Help by filling spawn with energy.
                var spawns = creep.room.find(FIND_STRUCTURES, {
                    filter: (structure) => structure.structureType == STRUCTURE_SPAWN
                });
                if (spawns && spawns.length > 0 && spawns[0].energy < spawns[0].energyCapacity * 0.8) {
                    if (creep.transfer(spawns[0], RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                        creep.moveToRange(spawns[0], 1);
                    }
                    return true;
                }

                if (!creep.memory.repairTarget) {
                    // Make sure ramparts don't break.
                    var targets = creep.room.find(FIND_STRUCTURES, {
                        filter: (structure) => structure.structureType == STRUCTURE_RAMPART && structure.hits < 10000
                    });
                    if (targets.length > 0) {
                        creep.memory.repairTarget = targets[0].id;
                    }
                }
                if (creep.memory.repairTarget) {
                    var target = Game.getObjectById(creep.memory.repairTarget);
                    if (!target || (target.structureType == STRUCTURE_RAMPART && target.hits > 15000)) {
                        delete creep.memory.repairTarget;
                    }

                    if (creep.repair(target) == ERR_NOT_IN_RANGE) {
                        creep.moveToRange(target, 3);
                    }
                    return true;
                }

                // Build structures.
                var targets = creep.room.find(FIND_MY_CONSTRUCTION_SITES);
                if (targets.length > 0) {
                    if (!creep.memory.buildTarget) {
                        creep.memory.resourceTarget = null;

                        // Build spawns before building anything else.
                        var spawnSites = _.filter(targets, (structure) => structure.structureType == STRUCTURE_SPAWN);
                        if (spawnSites.length > 0) {
                            creep.memory.buildTarget = spawnSites[0].id;
                        }
                        else {
                            // Towers are also very important.
                            var towerSites = _.filter(targets, (structure) => structure.structureType == STRUCTURE_TOWER);
                            if (towerSites.length > 0) {
                                creep.memory.buildTarget = towerSites[0].id;
                            }
                            else {
                                creep.memory.buildTarget = utilities.getClosest(creep, targets);
                            }
                        }
                    }
                    var best = creep.memory.buildTarget;
                    if (!best) {
                        return false;
                    }
                    var target = Game.getObjectById(best);
                    if (!target) {
                        creep.memory.buildTarget = null;
                    }

                    if (creep.build(target) == ERR_NOT_IN_RANGE) {
                        creep.moveToRange(target, 3);
                    }
                    return true;
                }
            }

            // Otherwise, upgrade controller.
            creep.memory.upgrading = true;
            if (creep.pos.getRangeTo(creep.room.controller) > 3) {
                creep.moveToRange(creep.room.controller, 3);
            }
            else {
                creep.upgradeController(creep.room.controller);
            }
            return false;
        }
        else {
            var dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
                filter: (drop) => drop.resourceType == RESOURCE_ENERGY && (drop.amount > creep.carryCapacity * 0.3 || creep.pos.getRangeTo(dropped) <= 1),
            });
            if (dropped) {
                if (creep.pos.getRangeTo(dropped) > 1) {
                    creep.moveToRange(dropped, 1);
                }
                else {
                    creep.pickup(dropped);
                }
                return true;
            }

            if (!creep.memory.resourceTarget) {
                // Try getting energy from full containers.
                var container = creep.pos.findClosestByRange(FIND_STRUCTURES, {
                    filter: (structure) => structure.structureType == STRUCTURE_CONTAINER && (structure.store.energy || 0) > 500,
                });
                if (container) {
                    if (creep.pos.getRangeTo(container) > 1) {
                        creep.moveToRange(container, 1);
                    }
                    else {
                        creep.withdraw(container, RESOURCE_ENERGY);
                    }
                    return true;
                }

                // If the room has no sources, there's nothing we can do.
                if (!creep.room.sources || creep.room.sources.length <= 0) {
                    return false;
                }

                // Try get energy from a source.
                var sources = creep.room.find(FIND_SOURCES_ACTIVE);
                if (sources.length > 0) {
                    creep.memory.resourceTarget = sources[Math.floor(Math.random() * sources.length)].id;
                    creep.memory.deliverTarget = null;
                }
                else {
                    // Or even get energy from adjacent rooms if marked.
                    var flags = _.filter(Game.flags, (flag) => flag.name.startsWith('ExtraEnergy:' + creep.pos.roomName));
                    if (flags.length > 0) {
                        var flag = _.sample(flags);
                        creep.memory.extraEnergyTarget = utilities.encodePosition(flag.pos);
                        creep.memory.sourceRoom = creep.pos.roomName;
                        return true;
                    }
                    else {
                        creep.performGetEnergy();
                        return true;
                    }
                }
            }
            var best = creep.memory.resourceTarget;
            if (!best) {
                return false;
            }
            source = Game.getObjectById(best);
            if (!source || source.energy <= 0) {
                creep.memory.resourceTarget = null;
            }

            var result = creep.harvest(source);
            if (result == ERR_NOT_IN_RANGE) {
                var result = creep.moveToRange(source, 1);
                if (!result) {
                    creep.memory.resourceTarget = null;

                    var flags = _.filter(Game.flags, (flag) => flag.name.startsWith('ExtraEnergy:' + creep.pos.roomName));
                    if (flags.length > 0) {
                        var flag = _.sample(flags);
                        creep.memory.extraEnergyTarget = utilities.encodePosition(flag.pos);
                        creep.memory.sourceRoom = creep.pos.roomName;
                        return true;
                    }
                }
            }
            return true;
        }
    },

};

module.exports = roleRemoteBuilder;
