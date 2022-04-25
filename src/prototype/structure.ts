import cache from 'utils/cache';
import {handleMapArea} from 'utils/map';

/* global Structure StructureExtension StructureSpawn StructureTower
STRUCTURE_RAMPART TOWER_OPTIMAL_RANGE TOWER_FALLOFF_RANGE TOWER_FALLOFF
OBSTACLE_OBJECT_TYPES BODYPART_COST */
declare global {
	interface Structure {
		heapMemory: StructureHeapMemory;
		isWalkable: () => boolean;
		isOperational: () => boolean;
	}

	interface StructureExtension {
		isBayExtension: () => boolean;
	}

	interface StructureSpawn {
		isBaySpawn: () => boolean;
		calculateCreepBodyCost;
		getSpawnDirections: () => DirectionConstant[];
	}

	interface StructureTower {
		getPowerAtRange;
	}

	interface StructureFactory {
		getEffectiveLevel: () => number;
	}

	interface StructureHeapMemory {}
}

// @todo Periodically clear heap memory of deceased creeps.
const structureHeapMemory: Record<string, StructureHeapMemory> = {};

// Define quick access property creep.heapMemory.
Object.defineProperty(Structure.prototype, 'heapMemory', {

	/**
	 * Gets semi-persistent memory for a structure.
	 *
	 * @return {object}
	 *   The memory object.
	 */
	get() {
		if (!structureHeapMemory[this.id]) structureHeapMemory[this.id] = {};

		return structureHeapMemory[this.id];
	},
	enumerable: false,
	configurable: true,
});

/**
 * Checks whether a structure can be moved onto.
 *
 * @return {boolean}
 *   True if a creep can move onto this structure.
 */
Structure.prototype.isWalkable = function () {
	if (_.includes(OBSTACLE_OBJECT_TYPES, this.structureType)) return false;
	if (this.structureType === STRUCTURE_RAMPART) {
		return this.my || this.isPublic;
	}

	return true;
};

/**
 * Replacement for Structure.prototype.isActive that is less CPU intensive.
 * @see InactiveStructuresProcess
 *
 * @return {boolean}
 *   True if the structure is operational.
 */
Structure.prototype.isOperational = function () {
	if (!this.room.memory.inactiveStructures) return true;
	if (!this.room.memory.inactiveStructures[this.id]) return true;
	return false;
};

/**
 * Checks whether this extension belongs to any bay.
 *
 * @return {boolean}
 *   True if the extension is part of a bay.
 */
StructureExtension.prototype.isBayExtension = function () {
	if (!this.bayChecked) {
		this.bayChecked = true;
		this.bay = null;

		for (const bay of this.room.bays) {
			if (bay.hasExtension(this)) {
				this.bay = bay;
				break;
			}
		}
	}

	return this.bay !== null;
};

StructureSpawn.prototype.isBaySpawn = StructureExtension.prototype.isBayExtension;

StructureSpawn.prototype.getSpawnDirections = function (this: StructureSpawn): DirectionConstant[] {
	if (!this.room.roomPlanner) return undefined;

	return cache.inHeap('spawnDir:' + this.name, 2500, () => {
		const directions = [];
		const terrain = this.room.getTerrain();

		handleMapArea(this.pos.x, this.pos.y, (x, y) => {
			if (x === this.pos.x && y === this.pos.y) return;
			if (terrain.get(x, y) === TERRAIN_MASK_WALL) return;

			const position = new RoomPosition(x, y, this.pos.roomName);
			if (!this.room.roomPlanner.isPlannedLocation(position, STRUCTURE_ROAD)) return;
			if (this.room.roomPlanner.isPlannedLocation(position, 'bay_center')) return;
			if (_.some(position.lookFor(LOOK_STRUCTURES), s => (OBSTACLE_OBJECT_TYPES as string[]).includes(s.structureType))) return;

			directions.push(this.pos.getDirectionTo(position));
		});

		if (directions.length === 0) return undefined;

		return directions;
	});
};

/**
 * Calculates relative tower power at a certain range.
 *
 * @param {number} range
 *   Tile distance between tower and target.
 *
 * @return {number}
 *   Relative power between 0 and 1.
 */
StructureTower.prototype.getPowerAtRange = function (this: StructureTower, range: number) {
	if (range < TOWER_OPTIMAL_RANGE) range = TOWER_OPTIMAL_RANGE;
	if (range > TOWER_FALLOFF_RANGE) range = TOWER_FALLOFF_RANGE;

	return 1 - (((range - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE)) * TOWER_FALLOFF);
};

/**
 * Calculates the cost of a creep's body parts.
 *
 * @param {object} bodyMemory
 *   An object keyed by body part type, with number of parts as values.
 *
 * @return {number}
 *   The total cost in energy units.
 */
StructureSpawn.prototype.calculateCreepBodyCost = function (bodyMemory) {
	// @todo This really doesn't need to be a method of StructureSpawn.
	let cost = 0;
	_.each(bodyMemory, (count, partType) => {
		cost += BODYPART_COST[partType] * count;
	});

	return cost;
};

/**
 * Calculates the level this factory should be considered to have.
 *
 * Even if the level is still 0, if a power creep with PWR_OPERATE_FACTORY
 * exists in the room, that power's level is returned.
 */
StructureFactory.prototype.getEffectiveLevel = function (this: StructureFactory): number {
	return cache.inObject(this.heapMemory, 'effectiveLevel', 500, () => {
		for (const name in this.room.powerCreeps) {
			const powerCreep = this.room.powerCreeps[name];

			if (powerCreep.powers[PWR_OPERATE_FACTORY]) return powerCreep.powers[PWR_OPERATE_FACTORY].level;
		}

		return 0;
	});
};

export {};
