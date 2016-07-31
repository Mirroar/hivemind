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
                return false;
            }
            var target = Game.getObjectById(best);

            if (creep.attack(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                creep.moveTo(target);
            }
            return true;
        }

        // Rally to defense flag.
        var targets = creep.room.find(FIND_FLAGS, {
            filter: (flag) => flag.name.startsWith('Defend')
        });
        if (targets.length > 0) {
            //var best = utilities.getClosest(creep, targets);
            //var target = Game.getObjectById(best);
            var target = targets[0];
            
            creep.moveTo(target);
            return true;
        }
        return false;
    },
    
    spawn: function (spawner) {
        if (spawner.room.energyAvailable >= spawner.room.energyCapacityAvailable * 0.9 && !spawner.spawning) {
            var body = utilities.generateCreepBody({move: 0.2, attack: 0.2, tough: 0.6}, spawner.room.energyAvailable);
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