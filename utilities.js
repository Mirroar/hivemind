/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('utilities');
 * mod.thing == 'a thing'; // true
 */

module.exports = {
    
    energyStored: function (room) {
        return 0;
    },
    
    scanRoom: function (room) {
        var sources = room.find(FIND_SOURCES);
        
        room.memory.sources = {};
        
        if (sources.length > 0) {
            for (var i in sources) {
                var source = sources[i];
                var id = source.id;
                room.memory.sources[id] = {};
                
                // Calculate free adjacent squares for max harvesters.
                var free = 0;
                var terrain = room.lookForAtArea(LOOK_TERRAIN, source.pos.y - 1, source.pos.x - 1, source.pos.y + 1, source.pos.x + 1, true);
                for (var t in terrain) {
                    var tile = terrain[t];
                    if (tile.x == source.pos.x && tile.y == source.pos.y) {
                        continue;
                    }
                    
                    //console.log(tile.terrain, tile.x, tile.y);
                    if (tile.terrain == 'plain' || tile.terrain == 'swamp') {
                        free++;
                    }
                }
                
                room.memory.sources[id].maxHarvesters = free;
                room.memory.sources[id].harvesters = [];
                
                // Keep harvesters which are already assigned.
                var harvesters = _.filter(Game.creeps, (creep) => creep.memory.role == 'harvester');
                for (var t in harvesters) {
                    var harvester = harvesters[t];
                    if (harvester.memory.fixedSource == id) {
                        room.memory.sources[id].harvesters.push(harvester.id);
                    }
                }
                
                // Unassign extra harvesters.
                while (room.memory.sources[id].harvesters.length > free) {
                    var old = room.memory.sources[id].harvesters.pop();
                    var harvester = Game.getObjectById(old);
                    delete harvester.memory.fixedSource;
                    delete harvester.memory.fixedTarget;
                }
                
                // Assign free harvesters.
                for (var t in harvesters) {
                    if (room.memory.sources[id].harvesters.length >= free) {
                        break;
                    }
                    
                    var harvester = harvesters[t];
                    if (!harvester.memory.fixedSource) {
                        room.memory.sources[id].harvesters.push(harvester.id);
                        harvester.memory.fixedSource = id;
                        delete harvester.memory.fixedTarget;
                    }
                }
                
                room.memory.sources[id].targetContainer = null;
                
                // Check if there is a container nearby.
                var structures = source.pos.findInRange(FIND_STRUCTURES, 3, {
                    filter: (structure) => structure.structureType == STRUCTURE_CONTAINER
                });
                if (structures && structures.length > 0) {
                    var structure = source.pos.findClosestByRange(structures);
                    if (structure) {
                        room.memory.sources[id].targetContainer = structure.id;
                    }
                }
                
                // Assign target container to available harvesters.
                if (room.memory.sources[id].targetContainer) {
                    for (var t in room.memory.sources[id].harvesters) {
                        var harvester = Game.getObjectById(room.memory.sources[id].harvesters[t]);
                        harvester.memory.fixedTarget = room.memory.sources[id].targetContainer;
                    }
                }
            }
        }
    },
    
    getClosest: function (creep, targets) {
        if (targets.length > 0) {
            var target = creep.pos.findClosestByPath(targets);
            if (target) {
                return target.id;
            }
        }
        return null;
    },
    
    getBodyCost: function (creep) {
        var cost = 0;
        for (var i in creep.body) {
            cost += BODYPART_COST[creep.body[i].type];
        }
        
        return cost;
    },

    generateCreepBody: function (weights, maxCost) {
        var newParts = {};
        var size = 0;
        var cost = 0;
        
        if (!maxCost) {
            maxCost = 300;
        }
        
        // Generate initial body containing at least one of each part.
        for (var part in weights) {
            newParts[part] = 1;
            size++;
            cost += BODYPART_COST[part];
        }
        
        if (cost > maxCost) {
            return null;
        }
        
        var done = false;
        while (!done) {
            done = true;
            for (var part in BODYPART_COST) {
                var currentWeight = newParts[part] / size;
                if (currentWeight <= weights[part] && cost + BODYPART_COST[part] <= maxCost) {
                    done = false;
                    newParts[part]++;
                    size++;
                    cost += BODYPART_COST[part];
                }
            }
        }
        
        //console.log('total cost of new body: ' + cost);
        
        // Chain the generated configuration into an array of body parts.
        var body = [];
        
        if (newParts.tough) {
            for (var i = 0; i < newParts.tough; i++) {
                body.push(TOUGH);
            }
            delete newParts.tough;
        }
        if (newParts.move) {
            // One move part will be added last.
            newParts.move--;
        }
        var done = false;
        while (!done) {
            done = true;
            for (var part in newParts) {
                if (newParts[part] > 0) {
                    body.push(part);
                    newParts[part]--;
                    done = false;
                }
            }
        }
        if (newParts.move !== undefined) {
            // Add last move part to make sure creep is always mobile.
            body.push(MOVE);
        }
        
        return body;
    }

};