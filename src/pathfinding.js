var utilities = require('utilities');

/**
 * Generates a new CostMatrix for pathfinding in this room.
 */
Room.prototype.generateCostMatrix = function (structures, constructionSites) {
    let costs = new PathFinder.CostMatrix;

    if (!structures) {
        structures = this.find(FIND_STRUCTURES);
    }
    if (!constructionSites) {
        constructionSites = this.find(FIND_MY_CONSTRUCTION_SITES);
    }

    structures.forEach(function (structure) {
        if (structure.structureType === STRUCTURE_ROAD) {
            // Only do this if no structure is on the road.
            if (costs.get(structure.pos.x, structure.pos.y) <= 0) {
                // Favor roads over plain tiles.
                costs.set(structure.pos.x, structure.pos.y, 1);
            }
        } else if (structure.structureType !== STRUCTURE_CONTAINER && (structure.structureType !== STRUCTURE_RAMPART || !structure.my)) {
            // Can't walk through non-walkable buildings.
            costs.set(structure.pos.x, structure.pos.y, 0xff);
        }
    });

    constructionSites.forEach(function (structure) {
        if (structure.structureType !== STRUCTURE_ROAD && structure.structureType !== STRUCTURE_CONTAINER && structure.structureType !== STRUCTURE_RAMPART) {
            // Can't walk through non-walkable construction sites.
            costs.set(structure.pos.x, structure.pos.y, 0xff);
        }
    });

    return costs;
};
