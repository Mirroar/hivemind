/* global Room STRUCTURE_CONTAINER FIND_HOSTILE_CREEPS
STRUCTURE_LINK STRUCTURE_NUKER STRUCTURE_OBSERVER LOOK_CREEPS
STRUCTURE_POWER_SPAWN FIND_SOURCES FIND_MINERALS */

import container from 'utils/container';
import Bay from 'manager.bay';
import cache from 'utils/cache';
import FactoryManager from 'factory-manager';
import RoomDefense from 'room-defense';
import utilities from 'utilities';
import {getUsername} from 'utils/account';

declare global {
	interface Room {
		creeps: Record<string, Creep>;
		powerCreeps: Record<string, PowerCreep>;
		creepsByRole: Record<string, Record<string, Creep>>;
		enemyCreeps: Record<string, Creep[]>;
		defense: RoomDefense;
		sources: Source[];
		minerals: Mineral[];
		enhanceData;
		scan;
		updateControllerContainer;
		updateControllerLink;
		updateStorageLink;
		needsScout;
		isMine: (allowReserved?: boolean) => boolean;
		nuker?: StructureNuker;
		powerSpawn?: StructurePowerSpawn;
		observer?: StructureObserver;
		factory?: StructureFactory;
		factoryManager: FactoryManager;
		needsReclaiming: () => boolean;
		isSafeForReclaiming: () => boolean;
	}

	interface RoomMemory {
		controllerLink?: any;
		controllerContainer?: any;
		storageLink?: any;
	}
}

// Define quick access property room.enemyCreeps.
Object.defineProperty(Room.prototype, 'enemyCreeps', {

	/**
	 * Gets all enemy creeps in a room, keyed by owner username.
	 *
	 * @return {Object}
	 *   All enemy creeps in this room.
	 */
	get(this: Room) {
		return cache.inObject(this, 'enemyCreeps', 1, () => _.groupBy(this.find(FIND_HOSTILE_CREEPS), 'owner.username'));
	},
	enumerable: false,
	configurable: true,
});

// Define quick access property room.enemyCreeps.
Object.defineProperty(Room.prototype, 'powerCreeps', {

	/**
	 * Gets all power creeps in a room, keyed by name.
	 *
	 * @return {Object}
	 *   All power creeps in this room.
	 */
	get(this: Room) {
		return cache.inObject(this, 'powerCreeps', 1, () => {
			const powerCreeps = {};
			for (const powerCreep of this.find(FIND_MY_POWER_CREEPS)) {
				powerCreeps[powerCreep.name] = powerCreep;
			}

			return powerCreeps;
		});
	},
	enumerable: false,
	configurable: true,
});

// Define quick access property room.defense
Object.defineProperty(Room.prototype, 'defense', {

	/**
	 * Gets a room's defense manager.
	 *
	 * @return {RoomDefense}
	 *   The room's defense manager.
	 */
	get(this: Room) {
		return cache.inObject(this, 'roomDefense', 1, () => new RoomDefense(this.name));
	},
	enumerable: false,
	configurable: true,
});

// Define quick access property room.sources
Object.defineProperty(Room.prototype, 'sources', {

	/**
	 * Gets a room's sources.
	 *
	 * @return {Source[]}
	 *   The room's sources.
	 */
	get(this: Room) {
		return cache.inObject(this, 'sources', 1, () => {
			const sourceIds = cache.inHeap('sources:' + this.name, 10_000, () => _.map(this.find(FIND_SOURCES), 'id'));

			return _.map(sourceIds, Game.getObjectById);
		});
	},
	enumerable: false,
	configurable: true,
});

// Define quick access property room.minerals
Object.defineProperty(Room.prototype, 'minerals', {

	/**
	 * Gets a room's minerals.
	 *
	 * @return {Source[]}
	 *   The room's minerals.
	 */
	get(this: Room): Mineral[] {
		return cache.inObject(this, 'minerals', 1, () => {
			const mineralIds = cache.inHeap('mineral:' + this.name, 10_000, () => _.map<Mineral, string>(this.find(FIND_MINERALS), 'id'));

			const minerals = [];
			for (const mineralId of mineralIds) {
				const mineral = Game.getObjectById(mineralId);
				if (!mineral) continue;

				minerals.push(mineral);
			}

			return minerals;
		});
	},
	enumerable: false,
	configurable: true,
});

const structuresToReference = [
	STRUCTURE_NUKER,
	STRUCTURE_OBSERVER,
	STRUCTURE_POWER_SPAWN,
	STRUCTURE_FACTORY,
];

for (const structureType of structuresToReference) {
	Object.defineProperty(Room.prototype, structureType, {
		get(this: Room) {
			return getCachedStructureReference(this, structureType);
		},
		enumerable: false,
		configurable: true,
	});
}

function getCachedStructureReference<T extends typeof structuresToReference[number]>(room: Room, structureType: T): Structure<T> {
	if (!room.controller) return null;

	const cacheKey = room.name + ':' + structureType + ':id';
	const structureId = cache.inHeap(cacheKey, 250, () => {
		if (CONTROLLER_STRUCTURES[structureType][room.controller.level] === 0) return null;

		const structures = room.structuresByType[structureType] || [];
		if (structures.length > 0) {
			return structures[0].id;
		}

		return null;
	});

	if (!structureId) return null;

	const structure = Game.getObjectById<Structure<T>>(structureId);
	if (!structure) {
		cache.removeEntry(null, cacheKey);
	}

	return structure;
};

Object.defineProperty(Room.prototype, 'factoryManager', {
	get(this: Room) {
		return cache.inObject(this, 'factoryManager', 1, () => this.factory.isOperational() ? new FactoryManager(this.name) : null);
	},
	enumerable: false,
	configurable: true,
});

Object.defineProperty(Room.prototype, 'bays', {
	get(this: Room) {
		return cache.inObject(this, 'bays', 1, () => {
			if (!this.isMine()) return [];
			if (!this.roomPlanner) return [];

			const bays = [];
			for (const pos of this.roomPlanner.getLocations('bay_center')) {
				let hasHarvester = false;
				if (this.roomPlanner.isPlannedLocation(pos, 'harvester')) {
					// @todo Don't use pos.lookFor, instead filter this.creepsByRole.harvester.
					const creeps = pos.lookFor(LOOK_CREEPS);
					hasHarvester = creeps.length > 0 && creeps[0].my && creeps[0].memory.role === 'harvester';
				}

				const bay = new Bay(pos, hasHarvester);
				bays.push(bay);
			}

			return bays;
		});
	},
	enumerable: false,
	configurable: true,
});

/**
 * Adds some additional data to room objects.
 */
Room.prototype.enhanceData = function (this: Room) {
	if (this.factory && !this.factory.isOperational()) delete this.factory;
	if (this.terminal && !this.terminal.isOperational()) delete this.terminal;
	if (this.storage && !this.storage.isOperational()) delete this.storage;

	// Prepare memory for creep cache (filled globally later).
	if (!this.creeps) {
		this.creeps = {};
		this.creepsByRole = {};
	}
};

/**
* Gathers information about a room and saves it to memory for faster access.
*/
Room.prototype.scan = function (this: Room) {
	this.updateControllerContainer();
	this.updateControllerLink();
	this.updateStorageLink();
};

/**
 * Updates location of the room's controller container.
 */
Room.prototype.updateControllerContainer = function (this: Room) {
	// @todo Split into a get function and set / delete value according to result.
	// Check if the controller has a container nearby.
	// Use room planner locations if available.
	if (this.roomPlanner) {
		const containerPositions: RoomPosition[] = this.roomPlanner.getLocations('container.controller');
		if (containerPositions.length > 0) {
			const structures = _.filter(
				this.structuresByType[STRUCTURE_CONTAINER], 
				structure => _.some(containerPositions, pos => pos.x === structure.pos.x && pos.y === structure.pos.y),
			);
			this.memory.controllerContainer = structures.length > 0 && structures[0].id;
			if (!this.memory.controllerContainer) delete this.memory.controllerContainer;
			return;
		}
	}

	const structures = _.filter(
		this.structuresByType[STRUCTURE_CONTAINER],
		structure => structure.pos.getRangeTo(this.controller) <= 3,
	);
	this.memory.controllerContainer = structures.length > 0 && structures[0].id;
	if (!this.memory.controllerContainer) delete this.memory.controllerContainer;
};

/**
 * Updates location of the room's controller link.
 */
Room.prototype.updateControllerLink = function (this: Room) {
	// @todo Split into a get function and set / delete value according to result.
	// Check if the controller has a link nearby.
	// Use room planner locations if available.
	if (this.roomPlanner) {
		const linkPositions: RoomPosition[] = this.roomPlanner.getLocations('link.controller');
		if (linkPositions.length > 0) {
			const structures = _.filter(
				this.myStructuresByType[STRUCTURE_LINK],
				structure => _.some(linkPositions, pos => pos.x === structure.pos.x && pos.y === structure.pos.y),
			);
			this.memory.controllerLink = structures.length > 0 && structures[0].id;
			if (!this.memory.controllerLink) delete this.memory.controllerLink;
			return;
		}
	}

	const structures = _.filter(
		this.myStructuresByType[STRUCTURE_LINK], 
		structure => structure.pos.getRangeTo(this.controller) <= 3,
	);
	this.memory.controllerLink = structures.length > 0 && structures[0].id;
	if (!this.memory.controllerLink) delete this.memory.controllerLink;
};

/**
 * Updates location of the room's storage link.
 */
Room.prototype.updateStorageLink = function (this: Room) {
	// @todo Split into a get function and set / delete value according to result.
	if (!this.storage) return;

	// Check if storage has a link nearby.
	// Use room planner locations if available.
	if (this.roomPlanner) {
		const linkPositions: RoomPosition[] = this.roomPlanner.getLocations('link.storage');
		if (linkPositions.length > 0) {
			const structures = _.filter(
				this.myStructuresByType[STRUCTURE_LINK], 
				structure => _.some(linkPositions, pos => pos.x === structure.pos.x && pos.y === structure.pos.y),
			);
			this.memory.storageLink = structures.length > 0 && structures[0].id;
			return;
		}
	}

	const structures = _.filter(
		this.myStructuresByType[STRUCTURE_LINK],
		structure => structure.pos.getRangeTo(this.storage) <= 3,
	);
	this.memory.storageLink = structures.length > 0 && structures[0].id;
};

/**
 * Decides if this room needs to send out a scout.
 *
 * @return {boolean}
 *   True if a scout is needed.
 */
Room.prototype.needsScout = function (this: Room) {
	if (!Memory.strategy) return false;

	const room = this;
	return _.any(Memory.strategy.roomList, (info: RoomListEntry) => info.origin === room.name && info.scoutPriority >= 1);
};

/**
 * Decides if the room belongs to the player.
 *
 * @param {boolean} allowReserved
 *   If specified, rooms reserved by the player are acceptable as well.
 *
 * @return {boolean}
 *   True if the room is owned / reserved by the player.
 */
Room.prototype.isMine = function (this: Room, allowReserved?: boolean) {
	if (!this.controller) return false;
	if (this.controller.my) return true;

	if (!allowReserved) return false;
	if (!this.controller.reservation) return false;
	if (this.controller.reservation.username === getUsername()) return true;

	return false;
};

Room.prototype.needsReclaiming = function (this: Room) {
	const reclaimManager = container.get('ReclaimManager');
	return reclaimManager.roomNeedsReclaiming(this);
};

Room.prototype.isSafeForReclaiming = function (this: Room) {
	const reclaimManager = container.get('ReclaimManager');
	return reclaimManager.roomIsSafeForReclaiming(this);
};
