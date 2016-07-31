var utilities = require('utilities');

/**
 * Get a priority list of military targets for this creep.
 */
Creep.prototype.getAvailableMilitaryTargets = function (creep) {
    var creep = this;
    var options = [];

    if (creep.memory.target) {
        var targetPosition = utilities.decodePosition(creep.memory.target);
        if (creep.pos.roomName == targetPosition.roomName) {

            // Find enemies to attack.
            if (creep.memory.body.attack) {
                var enemies = creep.room.find(FIND_HOSTILE_CREEPS);

                if (enemies && enemies.length > 0) {
                    for (var i in enemies) {
                        var enemy = enemies[i];

                        // Check if enemy is harmless, and ignore it.
                        let dangerous = false;
                        for (let j in enemy.body) {
                            let type = enemy.body[j].type;

                            if (type != MOVE && type != CARRY && type != TOUGH) {
                                dangerous = true;
                                break;
                            }
                        }
                        if (!dangerous) continue;

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
            }

            // Find friendlies to heal.
            if (creep.memory.body.heal) {
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
            }

            // Attack / Reserve controllers.
            if (creep.memory.body.claim && creep.memory.body.claim >= 5) {
                if (creep.room.controller.owner && !creep.room.controller.my) {
                    options.push({
                        priority: 5,
                        weight: 0,
                        type: 'controller',
                        object: creep.room.controller,
                    });
                }
            }

            // @todo Run home for healing if no functional parts are left.
        }
    }

    return options;
};

/**
 * Sets a good military target for this creep.
 */
Creep.prototype.calculateMilitaryTarget = function (creep) {
    var creep = this;
    var best = utilities.getBestOption(creep.getAvailableMilitaryTargets());

    if (best) {
        //console.log('best target for this', creep.memory.role , ':', best.object.id, '@ priority', best.priority, best.weight, 'HP:', best.object.hits, '/', best.object.hitsMax);
        var action = 'heal';
        if (best.type == 'hostilecreep' || best.type == 'hostilestructure') {
            action = 'attack';
        }
        else if (best.type == 'controller') {
            action = 'claim';
        }
        creep.memory.order = {
            type: action,
            target: best.object.id
        };
    }
    else {
        delete creep.memory.order;
    }
};

/**
 * Makes a creep move towards its designated target.
 */
Creep.prototype.performMilitaryMove = function () {
    var creep = this;
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
                ignoreDestructibleStructures: !creep.room.controller.my && creep.memory.body.attack,
            });
        }
    }
    else {
        creep.moveTo(25, 25, {
            reusePath: 50,
        });
    }
};

/**
 * Makes a creep try to attack its designated target or nearby enemies.
 */
Creep.prototype.performMilitaryAttack = function () {
    var creep = this;
    if (creep.memory.order) {
        var target = Game.getObjectById(creep.memory.order.target);
        var attacked = false;

        if (target && target instanceof StructureController) {
            //console.log('claim!');
            if (target.owner && !target.my) {
                var result = creep.attackController(target);
                if (result == OK) {
                    attacked = true;
                }
            }
            else if (!target.my) {
                // @todo reserve
            }
        }
        else if (target && !target.my) {
            var result = creep.attack(target);
            if (result == OK) {
                attacked = true;
            }
        }

        if (!attacked) {
            // See if enemies are nearby, attack one of those.
            var hostile = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 1);
            if (hostile.length > 0) {
                for (let i in hostile) {
                    // Check if enemy is harmless, and ignore it.
                    let dangerous = false;
                    for (let j in hostile[i].body) {
                        let type = hostile[i].body[j].type;

                        if (type != MOVE && type != CARRY && type != TOUGH) {
                            dangerous = true;
                            break;
                        }
                    }
                    if (!dangerous) continue;


                    if (creep.attack(hostile[i]) == OK) {
                        attacked = true;
                        break;
                    }
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
};

/**
 * Makes a creep heal itself or nearby injured creeps.
 */
Creep.prototype.performMilitaryHeal = function () {
    var creep = this;
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
};

/**
 * Makes a creep behave like a brawler.
 */
Creep.prototype.runBrawlerLogic = function () {
    // Target is recalculated every turn for best results.
    this.calculateMilitaryTarget();

    this.performMilitaryMove();

    if (!this.performMilitaryAttack()) {
        this.performMilitaryHeal();
    }
};
