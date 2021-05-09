'use strict';

/* global Source Mineral StructureKeeperLair LOOK_TERRAIN
FIND_STRUCTURES STRUCTURE_CONTAINER STRUCTURE_LINK STRUCTURE_KEEPER_LAIR */

const cache = require('./cache');

// Define quick access property source.harvesters.
Object.defineProperty(Source.prototype, 'harvesters', {
	/**
	 * Gets a source's assigned harvesters.
	 *
	 * @return {Creep[]}
	 *   Harvesters for this source.
	 */
	get() {
		return cache.inObject(this, 'harvesters', 1, () => {
			const harvesters = [];
			for (const harvester of _.values(this.room.creepsByRole.harvester) || []) {
				if (harvester.memory.fixedSource === this.id) {
					harvesters.push(harvester);
				}
			}

			return harvesters;
		});
	},
	enumerable: false,
	configurable: true,
});

// Define quick access property mineral.harvesters.
Object.defineProperty(Mineral.prototype, 'harvesters', {
	/**
	 * Gets a mineral's assigned harvesters.
	 *
	 * @return {Creep[]}
	 *   Harvesters for this mineral.
	 */
	get() {
		return cache.inObject(this, 'harvesters', 1, () => {
			const harvesters = [];
			for (const harvester of _.values(this.room.creepsByRole.harvester) || []) {
				if (harvester.memory.fixedMineral === this.id) {
					harvesters.push(harvester);
				}
			}

			return harvesters;
		});
	},
	enumerable: false,
	configurable: true,
});

/**
 * Calculates and caches the number of walkable tiles around a source.
 *
 * @return {number}
 *   Maximum number of harvesters on this source.
 */
const getNumHarvestSpots = function () {
	return cache.inHeap('numFreeSquares:' + this.id, 5000, () => {
		const terrain = this.room.lookForAtArea(LOOK_TERRAIN, this.pos.y - 1, this.pos.x - 1, this.pos.y + 1, this.pos.x + 1, true);
		const adjacentTerrain = [];
		for (const tile of terrain) {
			if (tile.x === this.pos.x && tile.y === this.pos.y) continue;
			if (tile.terrain === 'plain' || tile.terrain === 'swamp') {
				// @todo Make sure no structures are blocking this tile.
				adjacentTerrain.push(tile);
			}
		}

		return adjacentTerrain.length;
	});
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
	const containerId = cache.inHeap('container:' + this.id, 150, () => {
		// @todo Could use old data and just check if object still exits.
		// Check if there is a container nearby.
		const structures = this.pos.findInRange(FIND_STRUCTURES, 3, {
			filter: structure => structure.structureType === STRUCTURE_CONTAINER,
		});
		if (structures.length > 0) {
			const structure = this.pos.findClosestByRange(structures);
			return structure.id;
		}
	});

	if (containerId) {
		return Game.getObjectById(containerId);
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
	const linkId = cache.inHeap('link:' + this.id, 1000, () => {
		// @todo Could use old data and just check if object still exits.
		// Check if there is a link nearby.
		const structures = this.pos.findInRange(FIND_STRUCTURES, 3, {
			filter: structure => structure.structureType === STRUCTURE_LINK,
		});
		if (structures.length > 0) {
			const structure = this.pos.findClosestByRange(structures);
			return structure.id;
		}
	});

	if (linkId) {
		return Game.getObjectById(linkId);
	}
};

/**
 * Finds a source keeper lair in close proximity to this source.
 *
 * @return {StructureKeeperLair}
 *   The lair protecting this source.
 */
const getNearbyLair = function () {
	const lairId = cache.inHeap('lair:' + this.id, 150000, () => {
		// @todo Could use old data and just check if object still exits.
		// Check if there is a lair nearby.
		const structures = this.pos.findInRange(FIND_STRUCTURES, 10, {
			filter: structure => structure.structureType === STRUCTURE_KEEPER_LAIR,
		});
		if (structures.length > 0) {
			const structure = this.pos.findClosestByRange(structures);
			return structure.id;
		}
	});

	if (lairId) {
		return Game.getObjectById(lairId);
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

/**
 * Checks if a keeper lair is considered dangerous.
 *
 * @return {boolean}
 *   True if a source keeper is spawned or about to spawn.
 */
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
