'use strict';

/* global Source Mineral StructureKeeperLair ENERGY_REGEN_TIME LOOK_TERRAIN
FIND_STRUCTURES STRUCTURE_CONTAINER STRUCTURE_LINK STRUCTURE_KEEPER_LAIR */

/**
 * Adds additional data to room objects.
 *
 * Should be invoked for each spawn early in the script's lifetime.
 *
 * @param {string} collection
 *   Either 'sources' or 'mineralt'.
 * @param {string} creepAttribute
 *   Either 'fixedSource' or 'fixedMineral'.
 */
const enhanceData = function (collection, creepAttribute) {
	const roomMemory = Memory.rooms[this.pos.roomName];

	if (!roomMemory[collection]) {
		roomMemory[collection] = {};
	}

	if (!roomMemory[collection][this.id]) {
		roomMemory[collection][this.id] = {};
	}

	this.memory = roomMemory[collection][this.id];

	// Collect assigned harvesters.
	this.harvesters = [];
	for (const harvester of this.room.creepsByRole.harvester || []) {
		if (harvester.memory[creepAttribute] === this.id) {
			this.harvesters.push(harvester);
		}
	}
};

/**
 * Adds additional data to sources.
 */
Source.prototype.enhanceData = function () {
	enhanceData.call(this, 'sources', 'fixedSource');
};

/**
 * Adds additional data to minerals.
 */
Mineral.prototype.enhanceData = function () {
	enhanceData.call(this, 'minerals', 'fixedMineral');
};

/**
 * Calculates the maximum number of work parts for harvesting a source.
 *
 * @return {number}
 *   Number of needed work parts.
 */
Source.prototype.getMaxWorkParts = function () {
	// @todo get Rid of maxWorkParts variable in favor of this.
	// @todo Factor in whether we control this room.
	return 1.2 * this.energyCapacity / ENERGY_REGEN_TIME / 2;
};

/**
 * Finds all adjacent squares that are not blocked by walls.
 *
 * @return {RoomPosition[]}
 *   Any squares next to this source that a creep can be positioned on.
 */
const getAdjacentFreeSquares = function () {
	const terrain = this.room.lookForAtArea(LOOK_TERRAIN, this.pos.y - 1, this.pos.x - 1, this.pos.y + 1, this.pos.x + 1, true);
	const adjacentTerrain = [];
	for (const tile of terrain) {
		if (tile.x === this.pos.x && tile.y === this.pos.y) {
			continue;
		}

		if (tile.terrain === 'plain' || tile.terrain === 'swamp') {
			// @todo Make sure no structures are blocking this tile.
			adjacentTerrain.push(this.room.getPositionAt(tile.x, tile.y));
		}
	}

	return adjacentTerrain;
};

/**
 * Finds all adjacent squares that are not blocked by walls.
 *
 * @return {RoomPosition[]}
 *   Any squares next to this source that a creep can be positioned on.
 */
Source.prototype.getAdjacentFreeSquares = function () {
	return getAdjacentFreeSquares.call(this);
};

/**
 * Finds all adjacent squares that are not blocked by walls.
 *
 * @return {RoomPosition[]}
 *   Any squares next to this mineral that a creep can be positioned on.
 */
Mineral.prototype.getAdjacentFreeSquares = function () {
	return getAdjacentFreeSquares.call(this);
};

/**
 * Decides on a decent dropoff spot for energy close to the source and easily accessible by harvesters.
 *
 * @return {object}
 *   An object containing x and y coordinates for a source's dropoff spot.
 */
Source.prototype.getDropoffSpot = function () {
	// Decide on a dropoff-spot that will eventually have a container built.
	// @todo Maybe recalculate once in a while in case structures no block some tiles.
	if (!this.memory.dropoffSpot) {
		let best;
		let bestCount = 0;
		const terrain = this.room.lookForAtArea(LOOK_TERRAIN, this.pos.y - 2, this.pos.x - 2, this.pos.y + 2, this.pos.x + 2, true);
		const adjacentTerrain = this.getAdjacentFreeSquares();

		for (const tile of terrain) {
			if (this.pos.getRangeTo(tile.x, tile.y) <= 1) {
				continue;
			}

			if (tile.terrain === 'plain' || tile.terrain === 'swamp') {
				// @todo Make sure no structures are blocking this tile.
				const count = _.size(_.filter(adjacentTerrain, aTile => aTile.getRangeTo(tile.x, tile.y) <= 1));

				if (count > bestCount) {
					bestCount = count;
					best = tile;
				}
			}
		}

		if (best) {
			this.memory.dropoffSpot = {x: best.x, y: best.y};
		}
	}

	return this.memory.dropoffSpot;
};

/**
 * Calculates and caches the number of walkable tiles around a source.
 *
 * @return {number}
 *   Maximum number of harvesters on this source.
 */
const getNumHarvestSpots = function () {
	if (!this.memory.maxHarvestersCalculated || this.memory.maxHarvestersCalculated < Game.time - 1000) {
		this.memory.maxHarvestersCalculated = Game.time;
		this.memory.maxHarvesters = this.getAdjacentFreeSquares().length;
	}

	return this.memory.maxHarvesters;
};

/**
 * Calculates and caches the number of walkable tiles around a source.
 *
 * @return {number}
 *   Maximum number of harvesters on this source.
 */
Source.prototype.getNumHarvestSpots = function () {
	return getNumHarvestSpots.call(this);
};

/**
 * Calculates and caches the number of walkable tiles around a source.
 *
 * @return {number}
 *   Maximum number of harvesters on this mineral.
 */
Mineral.prototype.getNumHarvestSpots = function () {
	return getNumHarvestSpots.call(this);
};

/**
 * Finds a container in close proximity to this source, for dropping off energy.
 *
 * @return {StructureContainer}
 *   A container close to this source.
 */
const getNearbyContainer = function () {
	if (!this.memory.nearbyContainerCalculated || this.memory.nearbyContainerCalculated < Game.time - 150) {
		this.memory.nearbyContainerCalculated = Game.time;
		this.memory.targetContainer = null;

		// Check if there is a container nearby.
		const structures = this.pos.findInRange(FIND_STRUCTURES, 3, {
			filter: structure => structure.structureType === STRUCTURE_CONTAINER,
		});
		if (structures.length > 0) {
			const structure = this.pos.findClosestByRange(structures);
			this.memory.targetContainer = structure.id;
		}
	}

	if (this.memory.targetContainer) {
		return Game.getObjectById(this.memory.targetContainer);
	}
};

/**
 * Finds a container in close proximity to this source, for dropping off energy.
 *
 * @return {StructureContainer}
 *   A container close to this source.
 */
Source.prototype.getNearbyContainer = function () {
	return getNearbyContainer.call(this);
};

/**
 * Finds a container in close proximity to this mineral, for dropping off resources.
 *
 * @return {StructureContainer}
 *   A container close to this mineral.
 */
Mineral.prototype.getNearbyContainer = function () {
	return getNearbyContainer.call(this);
};

/**
 * Finds a link in close proximity to this source, for dropping off energy.
 *
 * @return {StructureLink}
 *   A link close to this source.
 */
Source.prototype.getNearbyLink = function () {
	if (!this.memory.nearbyLinkCalculated || this.memory.nearbyLinkCalculated < Game.time - 1000) {
		this.memory.nearbyLinkCalculated = Game.time;
		this.memory.targetLink = null;

		// Check if there is a link nearby.
		const structures = this.pos.findInRange(FIND_STRUCTURES, 3, {
			filter: structure => structure.structureType === STRUCTURE_LINK,
		});
		if (structures.length > 0) {
			const structure = this.pos.findClosestByRange(structures);
			this.memory.targetLink = structure.id;
		}
	}

	if (this.memory.targetLink) {
		return Game.getObjectById(this.memory.targetLink);
	}
};

/**
 * Finds a source keeper lair in close proximity to this source.
 *
 * @return {StructureKeeperLair}
 *   The lair protecting this source.
 */
const getNearbyLair = function () {
	if (!this.memory.nearbyLairCalculated || this.memory.nearbyLairCalculated < Game.time - 123456) {
		// This information really shouldn't ever change.
		this.memory.nearbyLairCalculated = Game.time;
		this.memory.nearbyLair = null;

		// Check if there is a link nearby.
		const structures = this.pos.findInRange(FIND_STRUCTURES, 10, {
			filter: structure => structure.structureType === STRUCTURE_KEEPER_LAIR,
		});
		if (structures.length > 0) {
			const structure = this.pos.findClosestByRange(structures);
			this.memory.nearbyLair = structure.id;
		}
	}

	if (this.memory.nearbyLair) {
		return Game.getObjectById(this.memory.nearbyLair);
	}
};

/**
 * Finds a source keeper lair in close proximity to this source.
 *
 * @return {StructureKeeperLair}
 *   The lair protecting this source.
 */
Source.prototype.getNearbyLair = function () {
	return getNearbyLair.call(this);
};

/**
 * Finds a source keeper lair in close proximity to this mineral.
 *
 * @return {StructureKeeperLair}
 *   The lair protecting this mineral.
 */
Mineral.prototype.getNearbyLair = function () {
	return getNearbyLair.call(this);
};

StructureKeeperLair.prototype.isDangerous = function () {
	return !this.ticksToSpawn || this.ticksToSpawn < 20;
};

/**
 * Checks if being close to this source is currently dangerous.
 *
 * @return {boolean}
 *   True if an active keeper lair is nearby and we have no defenses.
 */
const isDangerous = function () {
	const lair = this.getNearbyLair();
	if (!lair || !lair.isDangerous()) return false;

	// It's still safe if a guardian with sufficient lifespan is nearby to take care of any source keepers.
	if (this.room.creepsByRole.brawler) {
		for (const guardian of this.room.creepsByRole.brawler) {
			if (lair.pos.getRangeTo(guardian) < 5 && guardian.ticksToLive > 30 && guardian.memory.exploitUnitType === 'guardian') {
				return false;
			}
		}
	}

	return true;
};

/**
 * Checks if being close to this source is currently dangerous.
 *
 * @return {boolean}
 *   True if an active keeper lair is nearby and we have no defenses.
 */
Source.prototype.isDangerous = function () {
	return isDangerous.call(this);
};

/**
 * Checks if being close to this mineral is currently dangerous.
 *
 * @return {boolean}
 *   True if an active keeper lair is nearby and we have no defenses.
 */
Mineral.prototype.isDangerous = function () {
	return isDangerous.call(this);
};
