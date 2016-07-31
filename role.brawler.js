/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('role.brawler');
 * mod.thing == 'a thing'; // true
 */

var utilities = require('utilities');

var roleBrawler = {

    getAvailableTargets: function (creep) {
        var options = [];

        var tagetPosition = utilities.decodePosition(creep.memory.target);
        if (creep.pos.roomName == targetPosition.roomName) {
            // Find enemies to attack.
            // @todo only if attack parts are left.
            var enemies = creep.room.find(FIND_HOSTILE_CREEPS);

            if (enemies && enemies.length > 0) {
                for (var i in enemies) {
                    var enemy = enemies[i];

                    var option = {
                        priority: 4,
                        weight: 0,
                        type: 'hostilecreep',
                        object: enemy,
                    };

                    // @todo Calculate weight / priority from distance, HP left, parts.

                    options.push(option);
                }
            }

            // Find friendlies to heal.
            // @todo only if heal parts are left.
            var damaged = creep.room.find(FIND_MY_CREEPS, (friendly) => friendly.id != creep.id && friendly.hits < friendly.hitsMax);

            if (damaged && damaged.length > 0) {
                for (var i in damaged) {
                    var friendly = damaged[i];

                    var option = {
                        priority: 3,
                        weight: 0,
                        type: 'creep',
                        object: friendly,
                    };

                    // @todo Calculate weight / priority from distance, HP left, parts.

                    options.push(option);
                }
            }

            // @todo Run home for healing if no functional parts are left.
        }

        return options;
    },

    /**
     * Sets a good energy source target for this creep.
     */
    calculateTarget: function (creep) {
        var best = utilities.getBestOption(roleBrawler.getAvailableTargets(creep));

        if (best) {
            //console.log('best repair target for this', creep.memory.role , ':', best.object.structureType, best.object.id, '@ priority', best.priority, best.weight, 'HP:', best.object.hits, '/', best.object.hitsMax);
            creep.memory.order = {
                type: best.type == 'hostilecreep' ? 'attack' : 'heal',
                target: best.object.id
            };
        }
        else {
            delete creep.memory.order;
        }
    },

    move: function (creep) {
        var tagetPosition = utilities.decodePosition(creep.memory.target);
        if (creep.pos.roomName != targetPosition.roomName) {
            creep.moveTo(pos);
            return true;
        }

        if (creep.memory.order) {
            var target = Game.getObjectById(creep.memory.order.target);

            if (target) {
                creep.moveTo(target);
            }
        }
    },

    attack: function (creep) {
        if (creep.memory.order) {
            var target = Game.getObjectById(creep.memory.order.target);
            var attacked = false;

            if (target && !target.my) {
                var result = creep.attack(target);
                if (result != OK) {
                    attacked = true;
                }
            }

            if (!attacked) {
                // See if enemies are nearby, attack one of those.
                var hostile = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 1);
                if (hostile && hostile.length > 0) {
                    if (creep.attack(hostile[0]) == OK) {
                        attacked = true;
                    }
                }
            }

            return attacked;
        }
    },

    heal: function (creep) {
        if (creep.memory.order) {
            var target = Game.getObjectById(creep.memory.order.target);
            var healed = false;

            if (target && target.my) {
                var result = creep.heal(target);
                if (result != OK) {
                    healed = true;
                }
            }

            if (!healed) {
                // See if damaged creeps are adjacent, heal those.
                var damaged = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
                    filter: (creep) => creep.hits < creep.hitsMax
                });
                if (damaged && damaged.length > 0) {
                    if (creep.heal(damaged[0]) == OK) {
                        healed = true;
                    }
                }
            }

            if (!healed) {
                // See if damaged creeps are in range, heal those.
                var damaged = creep.pos.findInRange(FIND_MY_CREEPS, 3, {
                    filter: (creep) => creep.hits < creep.hitsMax
                });
                if (damaged && damaged.length > 0) {
                    if (creep.rangedHeal(damaged[0]) == OK) {
                        healed = true;
                    }
                }
            }

            return healed;
        }
    },

    /** @param {Creep} creep **/
    run: function (creep) {
        roleBrawler.calculateTarget(creep);

        roleBrawler.move(creep);

        if (!roleBrawler.attack(creep)) {
            roleBrawler.heal(creep);
        }
    },

    spawn: function (spawner, targetPosition) {
        if ((spawner.room.energyAvailable >= spawner.room.energyCapacityAvailable * 0.5) && !spawner.spawning) {
            var body = utilities.generateCreepBody({move: 0.35, tough: 0.35, attack: 0.2, heal: 0.1}, spawner.room.energyAvailable);

            if (spawner.canCreateCreep(body) == OK) {
                var newName = spawner.createCreep(body, undefined, {
                    role: 'brawler',
                    storage: utilities.encodePosition(spawner.room.storage.pos),
                    target: utilities.encodePosition(targetPosition)
                });
                console.log('Spawning new brawler to defend', utilities.encodePosition(targetPosition), ':', newName);

                // Save some stats.
                if (spawner.room.memory.remoteHarvesting && spawner.room.memory.remoteHarvesting[targetPosition.roomName]) {
                    var cost = 0;
                    for (var i in body) {
                        cost += BODYPART_COST[body[i]];
                    }

                    if (!spawner.room.memory.remoteHarvesting[targetPosition.roomName].defenseCost) {
                        spawner.room.memory.remoteHarvesting[targetPosition.roomName].defenseCost = 0;
                    }
                    spawner.room.memory.remoteHarvesting[targetPosition.roomName].defenseCost += cost;
                }

                return true;
            }
        }
        return false;
    }
};

module.exports = roleBrawler;
