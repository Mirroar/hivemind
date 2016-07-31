/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('role.defender');
 * mod.thing == 'a thing'; // true
 */

var utilities = require('utilities');

var roleDefender = {

    /** @param {Creep} creep **/
    run: function (creep) {
        var targets = creep.room.find(FIND_HOSTILE_CREEPS);
        if (targets.length > 0) {
            var best = utilities.getClosest(creep, targets);
            if (!best) {
                best = creep.pos.findClosestByRange(targets);
                if (best) {
                    best = best.id;
                    //console.log(best);
                }
            }
            if (best) {
                var target = Game.getObjectById(best);
    
                var attackType = 'attack';
                for (var i in creep.body) {
                    if (creep.body[i].type == RANGED_ATTACK && creep.body[i].hits > 0) {
                        attackType = 'rangedAttack';
                    }
                }
    
                var result = creep[attackType](target);
                if (result == OK) {
                    return true;
                }
                else if (result == ERR_NOT_IN_RANGE) {
                    var result = creep.moveTo(target);
                    if (result == OK) {
                        return true;
                    }
                }
            }
        }

        // Rally to defense flag.
        var target;
        if (creep.memory.targetFlag) {
            target = Game.getObjectById(creep.memory.targetFlag);
            if (!target) {
                creep.memory.targetFlag = null;
            }
        }
        if (!target) {
            var targets = creep.room.find(FIND_FLAGS, {
                filter: (flag) => flag.name.startsWith('Defend')
            });
            if (targets.length > 0) {
                //var best = utilities.getClosest(creep, targets);
                //target = Game.getObjectById(best);
                target = targets[0];
            }
        }
        
        if (target) {
            creep.moveTo(target);
            return true;
        }
        return false;
    },
    
    spawn: function (spawner) {
        if (spawner.room.energyAvailable >= spawner.room.energyCapacityAvailable * 0.9 && !spawner.spawning) {
            var body = utilities.generateCreepBody({move: 0.1, ranged_attack: 0.5, tough: 0.4}, spawner.room.energyAvailable);
            if (spawner.canCreateCreep(body) == OK) {
                var newName = spawner.createCreep(body, undefined, {role: 'defender'});
                console.log('Spawning new defender: ' + newName);
                return true;
            }
        }
        return false;
    }
};

module.exports = roleDefender;