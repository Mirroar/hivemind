var utilities = require('utilities');

/**
 * Get a priority list of military targets for this creep.
 */
Creep.prototype.getAvailableMilitaryTargets = function (creep) {
    var creep = this;
    var options = [];

    if (creep.memory.target) {
        var targetPosition = utilities.decodePosition(creep.memory.target);
        if (!targetPosition) {
            delete creep.memory.target;
            return options;
        }

        if (creep.pos.roomName == targetPosition.roomName) {

            // Find enemies to attack.
            if (creep.memory.body.attack) {
                var enemies = creep.room.find(FIND_HOSTILE_CREEPS);

                if (enemies && enemies.length > 0) {
                    for (var i in enemies) {
                        var enemy = enemies[i];

                        // Check if enemy is harmless, and ignore it.
                        if (!enemy.isDangerous()) continue;

                        var option = {
                            priority: 5,
                            weight: 1 - creep.pos.getRangeTo(enemy) / 50,
                            type: 'hostilecreep',
                            object: enemy,
                        };

                        // @todo Calculate weight / priority from distance, HP left, parts.

                        options.push(option);
                    }
                }

                // Find structures to attack.
                var structures = creep.room.find(FIND_HOSTILE_STRUCTURES, {
                    filter: (structure) => structure.structureType != STRUCTURE_CONTROLLER && structure.structureType != STRUCTURE_STORAGE && structure.hits
                });
                if (!creep.room.controller || !creep.room.controller.owner || creep.room.controller.owner.username == 'Voronoi') structures = [];

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
                if (creep.room.controller && creep.room.controller.owner && !creep.room.controller.my) {
                    var structures = creep.room.controller.pos.findInRange(FIND_STRUCTURES, 1, {
                        filter: (structure) => structure.structureType != STRUCTURE_CONTROLLER
                    });

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
                if (!damaged || damaged.length == 0) {
                    damaged = creep.room.find(FIND_HOSTILE_CREEPS, {
                        filter: (friendly) => ((friendly.id != creep.id) && (friendly.hits < friendly.hitsMax) && friendly.owner.username == 'Voronoi')
                    });
                }

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
            if (creep.memory.body.claim && !creep.room.controller.owner) {
                options.push({
                    priority: 4,
                    weight: 0,
                    type: 'controller',
                    object: creep.room.controller,
                });
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

    if (this.memory.fillWithEnergy) {
        if (_.sum(this.carry) < this.carryCapacity) {
            this.performGetEnergy();
            return true;
        }
        else {
            delete this.memory.fillWithEnergy;
        }
    }

    if (this.memory.pathName) {
        // @todo Decide if squad should be fully spawned / have an order or attack flag before moving along path.
        var flagName ='Path:' + this.memory.pathName + ':' + this.memory.pathStep;
        var flag = Game.flags[flagName];

        if (!flag) {
            console.log(this.name, 'reached end of path', this.memory.pathName, 'at step', this.memory.pathStep, 'and has', this.ticksToLive, 'ticks left to live.');

            delete this.memory.pathName;
            delete this.memory.pathStep;

            if (this.memory.squadUnitType == 'builder') {
                // Rebrand as remote builder to work in this room from now on.
                this.memory.role = 'builder.remote';
                this.memory.target = utilities.encodePosition(this.pos);
                this.memory.starting = false;
            }
        }
        else {
            this.moveTo(flag);
            if (this.pos.getRangeTo(flag) < 5) {
                console.log(this.name, 'reached waypoint', this.memory.pathStep, 'of path', this.memory.pathName, 'and has', this.ticksToLive, 'ticks left to live.');

                this.memory.pathStep++;
            }
            return true;
        }
    }

    if (this.memory.exploitName) {
        var exploit = Game.exploits[this.memory.exploitName];
        if (exploit) {
            // If an enemy is close by, move to attack it.
            let enemies = this.pos.findInRange(FIND_HOSTILE_CREEPS, 10, {
                filter: (enemy) => enemy.isDangerous()
            });
            if (enemies.length > 0) {
                this.memory.exploitTarget = enemies[0].id;
                this.moveTo(enemies[0]);
                return;
            }
            else if (this.memory.exploitTarget) {
                let target = Game.getObjectById(this.memory.exploitTarget);

                if (!target) {
                    delete this.memory.exploitTarget;
                }
                else {
                    this.moveTo(target);
                    return;
                }
            }

            // Clear cached path if we've gotton close to goal.
            if (this.memory.patrolPoint && this.hasCachedPath()) {
                let lair = Game.getObjectById(this.memory.patrolPoint);
                if (this.pos.getRangeTo(lair) <= 7) {
                    this.clearCachedPath();
                }
            }

            // Follow cached path when requested.
            if (this.hasCachedPath()) {
                this.followCachedPath();
                if (this.hasArrived()) {
                    this.clearCachedPath();
                }
                else {
                    return;
                }
            }

            if (this.pos.roomName != exploit.roomName) {
                // Follow cached path to target room.
                if (!this.hasCachedPath() && exploit.memory.pathToRoom) {
                    this.setCachedPath(exploit.memory.pathToRoom);
                    return;
                }
            }
            else {
                // In-room movement.

                // Start at closest patrol point to entrance
                if (!this.memory.patrolPoint) {
                    if (exploit.memory.closestLairToEntrance) {
                        this.memory.patrolPoint = exploit.memory.closestLairToEntrance;
                    }
                    else if (exploit.memory.lairs) {
                        for (let id in exploit.memory.lairs) {
                            this.memory.patrolPoint = id;
                            break;
                        }
                    }
                }

                if (this.memory.patrolPoint) {
                    this.memory.target = this.memory.patrolPoint;
                    let lair = Game.getObjectById(this.memory.patrolPoint);
                    if (!lair) return;

                    // Seems we have arrived at a patrol Point, and no enemies are immediately nearby.
                    // Find patrol point where we'll have the soonest fight.
                    let best = null;
                    let bestTime = null;

                    let id = this.memory.patrolPoint;
                    for (let id2 in exploit.memory.lairs) {
                        let otherLair = Game.getObjectById(id2);
                        if (!otherLair) continue;

                        let time = otherLair.ticksToSpawn || 0;

                        if (id != id2) {
                            if (exploit.memory.lairs[id].paths[id2].path) {
                                time = Math.max(time, exploit.memory.lairs[id].paths[id2].path.length);
                            }
                            else {
                                time = Math.max(time, exploit.memory.lairs[id2].paths[id].path.length);
                            }
                        }

                        if (!best || time < bestTime) {
                            best = id2;
                            bestTime = time;
                        }
                    }

                    if (best) {
                        if (best == this.memory.patrolPoint) {
                            // We're at the correct control point. Move to intercept potentially spawning source keepers.
                            if (exploit.memory.lairs[best].sourcePath) {
                                this.moveTo(utilities.decodePosition(exploit.memory.lairs[best].sourcePath.path[1]));
                            }
                            else {
                                this.moveToRange(lair, 1);
                            }
                        }
                        else {
                            this.memory.patrolPoint = best;
                            if (exploit.memory.lairs[id].paths[best].path) {
                                this.setCachedPath(exploit.memory.lairs[id].paths[best].path, false, 3);
                            }
                            else {
                                this.setCachedPath(exploit.memory.lairs[best].paths[id].path, true, 3);
                            }
                        }
                    }

                    return;
                }
                else {
                    // @todo No patrol points available, what now?
                }

            }
        }
    }

    if (creep.memory.squadName) {
        // Check if there are orders and set a target accordingly.
        var squad = Game.squads[creep.memory.squadName];
        if (squad) {
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

                    // If there's nothing to do, move back to spawn flag.
                    creep.moveTo(flag);
                }
            }

            return true;
        }
    }

    if (creep.memory.target) {
        var targetPosition = utilities.decodePosition(creep.memory.target);
        if (creep.pos.roomName != targetPosition.roomName) {
            if (this.hasCachedPath()) {
                this.followCachedPath();
                if (this.hasArrived()) {
                    this.clearCachedPath();
                }
            }
            else {
                // @todo This is cross-room movement and should therefore only calculate a path once.
                creep.moveTo(targetPosition);
            }

            return true;
        }
    }

    if (creep.memory.order) {
        var target = Game.getObjectById(creep.memory.order.target);

        if (target) {
            var result = creep.moveTo(target, {
                reusePath: 5,
                ignoreDestructibleStructures: (!creep.room.controller || !creep.room.controller.owner || (!creep.room.controller.my && creep.room.controller.owner.username != 'Voronoi')) && creep.memory.body.attack,
            });
        }
    }
    else {
        if (creep.memory.squadName) {
            var attackFlags = _.filter(Game.flags, (flag) => flag.name.startsWith('AttackSquad:' + creep.memory.squadName));
            if (attackFlags.length > 0) {
                creep.moveTo(attackFlags[0]);
                return;
            }
        }

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
                // If attack flag is directly on controller, claim it, otherwise just reserve.
                if (creep.memory.squadName && Game.flags['AttackSquad:' + creep.memory.squadName] && Game.flags['AttackSquad:' + creep.memory.squadName].pos.getRangeTo(target) == 0) {
                    var result = creep.claimController(target);
                    if (result == OK) {
                        attacked = true;
                    }
                }
                else {
                    var result = creep.reserveController(target);
                    if (result == OK) {
                        attacked = true;
                    }
                }
            }
        }
        else if (target && (!target.my && target.owner.username != 'Voronoi')) {
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
                    if (!hostile[i].isDangerous()) continue;
                    if (hostile[i].owner && hostile[i].owner.username == 'Voronoi') continue;

                    if (creep.attack(hostile[i]) == OK) {
                        attacked = true;
                        break;
                    }
                }
            }

            if (!attacked) {
                // See if enemy structures are nearby, attack one of those.
                var hostile = creep.pos.findInRange(FIND_HOSTILE_STRUCTURES, 1, {
                    filter: (structure) => structure.structureType != STRUCTURE_CONTROLLER && structure.structureType != STRUCTURE_STORAGE && structure.structureType != STRUCTURE_TERMINAL
                });
                if (creep.room.controller && creep.room.controller.owner && creep.room.controller.owner.username == 'Voronoi') hostile = [];
                if (hostile && hostile.length > 0) {
                    // Find target with lowest HP to kill off (usually relevant while trying to break through walls).
                    let minHits;
                    for (let i in hostile) {
                        if (hostile[i].hits && (!minHits || hostile[i].hits < hostile[minHits].hits)) {
                            minHits = i;
                        }
                    }
                    if (creep.attack(hostile[minHits]) == OK) {
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

        if (target && (target.my || (target.owner && target.owner.username == 'Voronoi'))) {
            var result = creep.heal(target);
            if (result == OK) {
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

Creep.prototype.initBrawlerState = function () {
    this.memory.initialized = true;

    if (this.memory.squadName) {
        var squad = Game.squads[this.memory.squadName];
        if (squad && squad.memory.pathName) {
            this.memory.pathName = squad.memory.pathName;
            this.memory.pathStep = 1;
        }
    }

    if (this.memory.squadUnitType == 'builder') {
        this.memory.fillWithEnergy = true;
    }

    if (this.memory.pathTarget) {
        if (this.room.memory.remoteHarvesting && this.room.memory.remoteHarvesting[this.memory.pathTarget] && this.room.memory.remoteHarvesting[this.memory.pathTarget].cachedPath) {
            this.setCachedPath(this.room.memory.remoteHarvesting[this.memory.pathTarget].cachedPath.path);
        }
    }
};

/**
 * Makes a creep behave like a brawler.
 */
Creep.prototype.runBrawlerLogic = function () {
    if (!this.memory.initialized) {
        this.initBrawlerState();
    }

    // Target is recalculated every turn for best results.
    this.calculateMilitaryTarget();

    this.performMilitaryMove();

    if (!this.performMilitaryAttack()) {
        this.performMilitaryHeal();
    }
};
