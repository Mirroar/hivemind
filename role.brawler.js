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

        if (creep.memory.target) {
            var targetPosition = utilities.decodePosition(creep.memory.target);
            if (creep.pos.roomName == targetPosition.roomName) {
                // Find enemies to attack.
                // @todo only if attack parts are left.
                var enemies = creep.room.find(FIND_HOSTILE_CREEPS);

                if (enemies && enemies.length > 0) {
                    for (var i in enemies) {
                        var enemy = enemies[i];

                        var option = {
                            priority: 5,
                            weight: 0,
                            type: 'hostilecreep',
                            object: enemy,
                        };

                        // @todo Calculate weight / priority from distance, HP left, parts.

                        options.push(option);
                    }
                }

                // Find structures to attack.
                var structures = creep.room.find(FIND_HOSTILE_STRUCTURES, {
                    filter: (structure) => structure.structureType != STRUCTURE_CONTROLLER && structure.structureType != STRUCTURE_STORAGE
                });

                if (structures && structures.length > 0) {
                    for (var i in structures) {
                        var structure = structures[i];

                        var option = {
                            priority: 2,
                            weight: 0,
                            type: 'hostilestructure',
                            object: structure,
                        };

                        // @todo Calculate weight / priority from distance, HP left, parts.
                        if (structure.structureType == STRUCTURE_SPAWN) {
                            option.priority = 4;
                        }
                        if (structure.structureType == STRUCTURE_TOWER) {
                            option.priority = 3;
                        }

                        options.push(option);
                    }
                }

                // Find walls in front of controller.
                if (creep.room.controller.owner && !creep.room.controller.my) {
                    var structures = creep.room.controller.pos.findInRange(FIND_STRUCTURES, 1);

                    if (structures && structures.length > 0) {
                        for (var i in structures) {
                            var structure = structures[i];

                            var option = {
                                priority: 0,
                                weight: 0,
                                type: 'hostilestructure',
                                object: structure,
                            };

                            options.push(option);
                        }
                    }
                }

                // Find friendlies to heal.
                // @todo only if heal parts are left.
                var damaged = creep.room.find(FIND_MY_CREEPS, {
                    filter: (friendly) => ((friendly.id != creep.id) && (friendly.hits < friendly.hitsMax))
                });

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
        }

        return options;
    },

    /**
     * Sets a good energy source target for this creep.
     */
    calculateTarget: function (creep) {
        var best = utilities.getBestOption(roleBrawler.getAvailableTargets(creep));

        if (best) {
            //console.log('best target for this', creep.memory.role , ':', best.object.id, '@ priority', best.priority, best.weight, 'HP:', best.object.hits, '/', best.object.hitsMax);
            creep.memory.order = {
                type: (best.type == 'hostilecreep' || best.type == 'hostilestructure') ? 'attack' : 'heal',
                target: best.object.id
            };
        }
        else {
            delete creep.memory.order;
        }
    },

    move: function (creep) {
        if (creep.memory.squadName) {
            // Check if there are orders and set a target accordingly.
            var squads = _.filter(Game.squads, (squad) => squad.name = creep.memory.squadName);
            if (squads.length > 0) {
                var squad = squads[0];

                var orders = squad.getOrders();
                if (orders.length > 0) {
                    creep.memory.target = orders[0].target;
                }
                else {
                    delete creep.memory.target;
                }
            }

            if (!creep.memory.target) {
                // Movement is dictated by squad orders.
                var spawnFlags = _.filter(Game.flags, (flag) => flag.name.startsWith('SpawnSquad:' + creep.memory.squadName));
                if (spawnFlags.length > 0) {
                    var flag = spawnFlags[0];
                    if (creep.pos.roomName == flag.pos.roomName) {
                        // Refresh creep if it's getting low, so that it has high lifetime when a mission finally starts.
                        if (creep.ticksToLive < CREEP_LIFE_TIME * 0.66) {
                            var spawn = creep.pos.findClosestByRange(FIND_STRUCTURES, {
                                filter: (structure) => structure.structureType == STRUCTURE_SPAWN
                            });

                            if (spawn) {
                                if (spawn.renewCreep(creep) !== OK) {
                                    creep.moveTo(spawn);
                                }
                                return true;
                            }
                        }
                    }

                    // If there's nothing to do, move back to spawn flag.
                    creep.moveTo(flag);
                }

                return true;
            }
        }

        if (creep.memory.target) {
            var targetPosition = utilities.decodePosition(creep.memory.target);
            if (creep.pos.roomName != targetPosition.roomName) {
                creep.moveTo(targetPosition);
                return true;
            }
        }

        if (creep.memory.order) {
            var target = Game.getObjectById(creep.memory.order.target);

            if (target) {
                var result = creep.moveTo(target, {
                    reusePath: 0,
                    ignoreDestructibleStructures: !creep.room.controller.my,
                });
            }
        }
        else {
            creep.moveTo(25, 25, {
                reusePath: 50,
            });
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

                if (!attacked) {
                    // See if enemy structures are nearby, attack one of those.
                    var hostile = creep.pos.findInRange(FIND_HOSTILE_STRUCTURES, 1, {
                        filter: (structure) => structure.structureType != STRUCTURE_CONTROLLER && structure.structureType != STRUCTURE_STORAGE
                    });
                    if (hostile && hostile.length > 0) {
                        if (creep.attack(hostile[0]) == OK) {
                            attacked = true;
                        }
                    }
                }
            }

            return attacked;
        }
    },

    heal: function (creep) {
        var healed = false;
        if (creep.memory.order) {
            var target = Game.getObjectById(creep.memory.order.target);

            if (target && target.my) {
                var result = creep.heal(target);
                if (result != OK) {
                    healed = true;
                }
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

        if (!healed && creep.hits < creep.hitsMax) {
            // Heal self.
            if (creep.heal(creep) == OK) {
                healed = true;
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
    },

    /** @param {Creep} creep **/
    run: function (creep) {
        roleBrawler.calculateTarget(creep);

        roleBrawler.move(creep);

        if (!roleBrawler.attack(creep)) {
            roleBrawler.heal(creep);
        }
    },

};

module.exports = roleBrawler;
