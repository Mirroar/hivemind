/* global Room FIND_STRUCTURES STRUCTURE_CONTAINER FIND_HOSTILE_CREEPS
STRUCTURE_LINK STRUCTURE_NUKER STRUCTURE_OBSERVER LOOK_CREEPS
STRUCTURE_POWER_SPAWN FIND_SOURCES FIND_MINERALS */

import Bay from 'manager.bay';
import cache from 'utils/cache';
import Exploit from 'manager.exploit';
import FactoryManager from 'factory-manager';
import RoomDefense from 'room-defense';
import utilities from 'utilities';
import {getUsername} from 'utils/account';

declare global {
	interface Room {
		creeps: {
			[creepName: string]: Creep;
		};
		powerCreeps: {
			[creepName: string]: PowerCreep;
		}
		creepsByRole: {
			[roleName: string]: {
				[creepName: string]: Creep;
			};
		};
		enemyCreeps: {
			[key: string]: Creep[];
		};
		exploits: Record<string, Exploit>;
		defense: RoomDefense;
		sources: Source[];
		mineral: Mineral;
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
	get() {
		if (!this._enemyCreeps) {
			this._enemyCreeps = _.groupBy(this.find(FIND_HOSTILE_CREEPS), 'owner.username');
		}

		return this._enemyCreeps;
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
	get() {
		if (!this._defenseManager) {
			this._defenseManager = new RoomDefense(this.name);
		}

		return this._defenseManager;
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
	get() {
		return cache.inObject(this, 'sources', 1, () => {
			const sourceIds = cache.inHeap('sources:' + this.name, 10000, () => {
				return _.map(this.find(FIND_SOURCES), 'id');
			});

			return _.map(sourceIds, Game.getObjectById);
		});
	},
	enumerable: false,
	configurable: true,
});

// Define quick access property room.mineral
Object.defineProperty(Room.prototype, 'mineral', {

	/**
	 * Gets a room's mineral.
	 *
	 * @return {Source[]}
	 *   The room's mineral.
	 */
	get(): Mineral {
		return cache.inObject(this, 'mineral', 1, () => {
			const mineralIds = cache.inHeap('mineral:' + this.name, 10000, () => {
				return _.map<Mineral, string>(this.find(FIND_MINERALS), 'id');
			});

			return mineralIds[0] && Game.getObjectById(mineralIds[0]);
		});
	},
	enumerable: false,
	configurable: true,
});

/**
 * Adds some additional data to room objects.
 */
Room.prototype.enhanceData = function (this: Room) {
	this.addStructureReference(STRUCTURE_NUKER);
	this.addStructureReference(STRUCTURE_OBSERVER);
	this.addStructureReference(STRUCTURE_POWER_SPAWN);
	this.addStructureReference(STRUCTURE_FACTORY);

	if (this.factory) {
		if (this.factory.isOperational()) {
			this.factoryManager = new FactoryManager(this.name);
		}
		else delete this.factory;
	}

	if (this.terminal && !this.terminal.isOperational()) {
		delete this.terminal;
	}

	if (this.storage && !this.storage.isOperational()) {
		delete this.storage;
	}

	// Prepare memory for creep cache (filled globally later).
	if (!this.creeps) {
		this.creeps = {};
		this.creepsByRole = {};
	}

	// Register bays.
	this.bays = [];
	if (this.isMine() && this.roomPlanner) {
		for (const pos of this.roomPlanner.getLocations('bay_center')) {
			let hasHarvester = false;
			if (this.roomPlanner.isPlannedLocation(pos, 'harvester')) {
				// @todo Don't use pos.lookFor, instead filter this.creepsByRole.harvester.
				const creeps = pos.lookFor(LOOK_CREEPS);
				hasHarvester = creeps.length > 0 && creeps[0].my && creeps[0].memory.role === 'harvester';
			}

			this.bays.push(new Bay(pos, hasHarvester));
		}
	}

	// Register exploits.
	this.exploits = {};
	if (this.controller && this.controller.level >= 7) {
		const flags = _.filter(Game.flags, flag => flag.name.startsWith('Exploit:' + this.name + ':'));
		for (const flag of flags) {
			utilities.bubbleWrap(() => {
				this.exploits[flag.pos.roomName] = new Exploit(this, flag.name);
				Game.exploits[flag.pos.roomName] = this.exploits[flag.pos.roomName];
			});
		}
	}
};

/**
* Gathers information about a room and saves it to memory for faster access.
*/
Room.prototype.scan = function () {
	this.updateControllerContainer();
	this.updateControllerLink();
	this.updateStorageLink();
};

/**
 * Updates location of the room's controller container.
 */
Room.prototype.updateControllerContainer = function () {
	// Check if the controller has a container nearby.
	// Use room planner locations if available.
	if (this.roomPlanner) {
		const containerPositions: RoomPosition[] = this.roomPlanner.getLocations('container.controller');
		if (containerPositions.length > 0) {
			const structures = this.find(FIND_STRUCTURES, {
				filter: structure => structure.structureType === STRUCTURE_CONTAINER &&
				_.filter(containerPositions, pos => pos.x === structure.pos.x && pos.y === structure.pos.y).length > 0,
			});
			this.memory.controllerContainer = structures.length > 0 && structures[0].id;
			return;
		}
	}

	const structures = this.find(FIND_STRUCTURES, {
		filter: structure => structure.structureType === STRUCTURE_CONTAINER && structure.pos.getRangeTo(this.controller) <= 3,
	});
	this.memory.controllerContainer = structures.length > 0 && structures[0].id;
};

/**
 * Updates location of the room's controller link.
 */
Room.prototype.updateControllerLink = function () {
	// Check if the controller has a link nearby.
	// Use room planner locations if available.
	if (this.roomPlanner) {
		const linkPositions: RoomPosition[] = this.roomPlanner.getLocations('link.controller');
		if (linkPositions.length > 0) {
			const structures = this.find(FIND_STRUCTURES, {
				filter: structure => structure.structureType === STRUCTURE_LINK &&
				_.filter(linkPositions, pos => pos.x === structure.pos.x && pos.y === structure.pos.y).length > 0,
			});
			this.memory.controllerLink = structures.length > 0 && structures[0].id;
			return;
		}
	}

	const structures = this.find(FIND_STRUCTURES, {
		filter: structure => structure.structureType === STRUCTURE_LINK && structure.pos.getRangeTo(this.controller) <= 3,
	});
	this.memory.controllerLink = structures.length > 0 && structures[0].id;
};

/**
 * Updates location of the room's storage link.
 */
Room.prototype.updateStorageLink = function () {
	if (!this.storage) return;

	// Check if storage has a link nearby.
	// Use room planner locations if available.
	if (this.roomPlanner) {
		const linkPositions: RoomPosition[] = this.roomPlanner.getLocations('link.storage');
		if (linkPositions.length > 0) {
			const structures = this.find(FIND_STRUCTURES, {
				filter: structure => structure.structureType === STRUCTURE_LINK &&
				_.filter(linkPositions, pos => pos.x === structure.pos.x && pos.y === structure.pos.y).length > 0,
			});
			this.memory.storageLink = structures.length > 0 && structures[0].id;
			return;
		}
	}

	const structures = this.find(FIND_STRUCTURES, {
		filter: structure => structure.structureType === STRUCTURE_LINK && structure.pos.getRangeTo(this.storage) <= 3,
	});
	this.memory.storageLink = structures.length > 0 && structures[0].id;
};

/**
 * Decides if this room needs to send out a scout.
 *
 * @return {boolean}
 *   True if a scout is needed.
 */
Room.prototype.needsScout = function () {
	if (!Memory.strategy) return false;

	const room = this;
	return _.any(Memory.strategy.roomList, (info: any) => info.origin === room.name && info.scoutPriority >= 1);
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
Room.prototype.isMine = function (allowReserved?: boolean) {
	if (!this.controller) return false;
	if (this.controller.my) return true;

	if (!allowReserved) return false;
	if (!this.controller.reservation) return false;
	if (this.controller.reservation.username === getUsername()) return true;

	return false;
};
