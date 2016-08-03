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

        var targetPosition = utilities.decodePosition(creep.memory.target);
        if (targetPosition.roomName != creep.pos.roomName) {
            creep.moveTo(targetPosition);
            return true;
        }

        if (creep.memory.building && creep.carry.energy == 0) {
            creep.memory.building = false;
            creep.memory.buildTarget = null;
            creep.memory.tempRole = null;
        }
        else if (!creep.memory.building && creep.carry.energy == creep.carryCapacity) {
            creep.memory.building = true;
            creep.memory.resourceTarget = null;
            creep.memory.tempRole = null;
        }

        if (creep.memory.building) {
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

            var targets = creep.room.find(FIND_CONSTRUCTION_SITES);
            if (targets.length > 0) {
                if (!creep.memory.buildTarget) {
                    creep.memory.resourceTarget = null;
                    creep.memory.buildTarget = utilities.getClosest(creep, targets);
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
                    creep.moveTo(target);
                }
                return true;
            }

            // If there is nothing to build, help by filling spawn with energy.
            var spawners = creep.room.find(FIND_STRUCTURES, {
                filter: (structure) => structure.structureType == STRUCTURE_SPAWN
            });
            if (spawners && spawners.length > 0) {
                if (creep.transfer(spawners[0], RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(spawners[0]);
                }
                return true;
            }
            return false;
        }
        else {
            if (!creep.memory.resourceTarget) {
                if (!creep.room.sources || creep.room.sources.length <= 0) {
                    return false;
                }

                //creep.memory.resourceTarget = utilities.getClosest(creep, sources);
                creep.memory.resourceTarget = creep.room.sources[Math.floor(Math.random() * creep.room.sources.length)].id;
                creep.memory.deliverTarget = null;
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
                var result = creep.moveTo(source);
                if (result == ERR_NO_PATH) {
                    creep.memory.resourceTarget = null;
                }
            }
            return true;
        }
    },

};

module.exports = roleRemoteBuilder;
