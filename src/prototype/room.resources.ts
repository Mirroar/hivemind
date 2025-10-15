/* global Room RoomPosition RESOURCE_ENERGY LOOK_RESOURCES
RESOURCE_POWER STRUCTURE_LAB RESOURCES_ALL */

import cache from 'utils/cache';
import container from 'utils/container';
import RemoteMiningOperation from 'operation/remote-mining';
import ResourceDestinationDispatcher from 'dispatcher/resource-destination/dispatcher';
import ResourceSourceDispatcher from 'dispatcher/resource-source/dispatcher';
import {decodePosition} from 'utils/serialization';
import {getRoomIntel} from 'room-intel';
import type {ResourceLevel} from 'room/resource-level-manager';
import {getResourcesIn} from 'utils/store';

declare global {
	interface Room {
		sourceDispatcher: ResourceSourceDispatcher;
		destinationDispatcher: ResourceDestinationDispatcher;
		getStorageLimit: () => number;
		getFreeStorage: () => number;
		getCurrentResourceAmount: (resourceType: string) => number;
		getStoredEnergy: () => number;
		getCurrentMineralAmount: () => number;
		getEffectiveAvailableEnergy: () => number;
		getEffectiveAvailableMinerals: (resourceType: ResourceConstant) => number;
		isFullOnEnergy: () => boolean;
		isFullOnPower: () => boolean;
		isFullOnMinerals: () => boolean;
		isFullOn: (resourceType: string) => boolean;
		getStorageLocation: () => RoomPosition;
		prepareForTrading: (resourceType: ResourceConstant, amount?: number) => void;
		stopTradePreparation: () => void;
		getRemoteHarvestSourcePositions: () => RoomPosition[];
		getRemoteReservePositions: () => RoomPosition[];
		getResourceState: () => RoomResourceState;
		getBestStorageTarget: (amount: number, resourceType: ResourceConstant) => StructureStorage | StructureTerminal;
		getBestStorageSource: (resourceType: ResourceConstant) => StructureStorage | StructureTerminal;
		getBestCircumstancialStorageSource: (resourceType: ResourceConstant) => StructureStorage | StructureTerminal;
	}

	interface RoomMemory {
		fillTerminal?: ResourceConstant;
		fillTerminalAmount?: number;
	}

	interface RoomResourceState {
		totalResources: Partial<Record<ResourceConstant, number>>;
		state: Partial<Record<ResourceConstant, ResourceLevel>>;
		canTrade: boolean;
		isEvacuating: boolean;
		mineralTypes: ResourceConstant[];
		addResource: (resourceType: ResourceConstant, amount: number) => void;
	}

	interface Source {
		isDangerous: () => boolean;
	}

	interface Mineral {
		isDangerous: () => boolean;
	}

	interface StructureKeeperLair {
		isDangerous: () => boolean;
	}
}

type SourceEvaluation = {
	location: string;
	sourceCount: number;
	distance: number;
	averageDistance: number;
};

// Define quick access property room.sourceDispatcher.
Object.defineProperty(Room.prototype, 'sourceDispatcher', {
	get(this: Room) {
		return cache.inObject(this, 'sourceDispatcher', 1, () => new ResourceSourceDispatcher(this));
	},
	enumerable: false,
	configurable: true,
});

// Define quick access property room.destinationDispatcher.
Object.defineProperty(Room.prototype, 'destinationDispatcher', {
	get(this: Room) {
		return cache.inObject(this, 'destinationDispatcher', 1, () => new ResourceDestinationDispatcher(this));
	},
	enumerable: false,
	configurable: true,
});

/**
 * Determines maximum storage capacity within a room.
 *
 * @return {number}
 *   The total storage limit.
 */
Room.prototype.getStorageLimit = function (this: Room) {
	let total = 0;
	if (this.storage && !this.isClearingStorage()) {
		total += this.storage.store.getCapacity();
	}

	if (this.terminal && !this.isClearingTerminal()) {
		total += this.terminal.store.getCapacity();
	}

	if (total === 0) {
		// Assume 10000 storage for dropping stuff on the ground.
		total += 10_000;
	}

	return total;
};

/**
 * Determines amount of currently available storage.
 *
 * @return {number}
 *   The currently available free storage space.
 */
Room.prototype.getFreeStorage = function (this: Room) {
	// Determines amount of free space in storage.
	let limit = this.getStorageLimit();
	if (this.storage && !this.isClearingStorage()) {
		// Only count storage resources if we count it's free capacity.
		limit -= Math.min(this.storage.store.getCapacity(), this.storage.store.getUsedCapacity());
	}

	if (this.terminal && !this.isClearingTerminal()) {
		// Only count terminal resources if we count it's free capacity.
		limit -= Math.min(this.terminal.store.getCapacity(), this.terminal.store.getUsedCapacity());
	}

	return limit;
};

/**
 * Determines the amount of a resource currently stored in this room.
 *
 * @param {string} resourceType
 *   The resource in question.
 *
 * @return {number}
 *   Amount of this resource in storage or terminal.
 */
Room.prototype.getCurrentResourceAmount = function (this: Room, resourceType: ResourceConstant): number {
	return getAllResources(this)[resourceType] || 0;
};

function getAllResources(room: Room): Record<string, number> {
	return cache.inObject(room, 'allResources', 1, () => {
		const resources: Record<string, number> = {};

		for (const resourceType of getResourcesIn(room.storage?.store)) {
			resources[resourceType] = (resources[resourceType] || 0) + room.storage.store[resourceType];
		}

		for (const resourceType of getResourcesIn(room.terminal?.store)) {
			resources[resourceType] = (resources[resourceType] || 0) + room.terminal.store[resourceType];
		}

		// Add resources in transporters to prevent fluctuation from transporters
		// moving stuff around.
		_.each(room.creepsByRole.transporter, creep => {
			for (const resourceType of getResourcesIn(creep.store)) {
				resources[resourceType] = (resources[resourceType] || 0) + creep.store[resourceType];
			}
		});

		if (!room.terminal && !room.storage) {
			// Until a storage is built, haulers effectively act as transporters.
			_.each(room.creepsByRole.hauler, creep => {
				for (const resourceType of getResourcesIn(creep.store)) {
					resources[resourceType] = (resources[resourceType] || 0) + creep.store[resourceType];
				}
			});
		}

		return resources;
	});
}

/**
 * Gets amount of energy stored, taking into account energy on storage location.
 *
 * @return {number}
 *   Amount of energy this room has available.
 */
Room.prototype.getStoredEnergy = function (this: Room) {
	return cache.inObject(this, 'storedEnergy', 1, () => {
		let total = this.getCurrentResourceAmount(RESOURCE_ENERGY);

		// Add energy on storage location (pre storage).
		const storageLocation = this.getStorageLocation();
		if (!storageLocation) return total;
		const storagePosition = new RoomPosition(storageLocation.x, storageLocation.y, this.name);
		const resources = _.filter(storagePosition.lookFor(LOOK_RESOURCES), resource => resource.resourceType === RESOURCE_ENERGY);
		if (resources.length > 0) {
			total += resources[0].amount;
		}

		// Add dropped resources and containers on harvest spots.
		const harvestPositions = this.roomPlanner?.getLocations('harvester');
		for (const position of harvestPositions || []) {
			for (const resource of position.lookFor(LOOK_RESOURCES)) {
				if (resource.resourceType !== RESOURCE_ENERGY) continue;

				total += resource.amount;
			}

			for (const structure of position.lookFor(LOOK_STRUCTURES)) {
				if (structure.structureType !== STRUCTURE_CONTAINER) continue;

				total += (structure as StructureContainer).store.getUsedCapacity(RESOURCE_ENERGY);
			}
		}

		// Add controller container.
		const container = this.memory.controllerContainer && Game.getObjectById<StructureContainer>(this.memory.controllerContainer);
		if (container) total += container.store.getUsedCapacity(RESOURCE_ENERGY);

		return total;
	});
};

/**
 * Gets amount of minerals and mineral compounds stored in a room.
 *
 * @return {number}
 *   Amount of minerals stored in this room.
 */
Room.prototype.getCurrentMineralAmount = function (this: Room) {
	return cache.inObject(this, 'storedMinerals', 1, () => {
		let total = 0;

		for (const resourceType of RESOURCES_ALL) {
			if (resourceType === RESOURCE_ENERGY || resourceType === RESOURCE_POWER) continue;
			total += this.getCurrentResourceAmount(resourceType);
		}

		return total;
	});
};

/**
 * Gets amount of energy stored, taking into account batteries.
 *
 * @return {number}
 *   Amount of energy this room has available.
 */
Room.prototype.getEffectiveAvailableEnergy = function (this: Room) {
	const availableEnergy = this.getStoredEnergy();

	if (!this.factory || !this.factory.isOperational() || this.isEvacuating()) return availableEnergy;

	// @todo Get resource unpacking factor from API or config.
	return availableEnergy + (Math.max(0, this.getCurrentResourceAmount(RESOURCE_BATTERY) - 5000) * 5);
};

const mineralBars = {
    [RESOURCE_HYDROGEN]: RESOURCE_REDUCTANT,
    [RESOURCE_OXYGEN]: RESOURCE_OXIDANT,
    [RESOURCE_UTRIUM]: RESOURCE_UTRIUM_BAR,
    [RESOURCE_KEANIUM]: RESOURCE_KEANIUM_BAR,
    [RESOURCE_LEMERGIUM]: RESOURCE_LEMERGIUM_BAR,
    [RESOURCE_ZYNTHIUM]: RESOURCE_ZYNTHIUM_BAR,
    [RESOURCE_CATALYST]: RESOURCE_PURIFIER,
	[RESOURCE_GHODIUM]: RESOURCE_GHODIUM_MELT,
}

Room.prototype.getEffectiveAvailableMinerals = function (this: Room, resourceType: ResourceConstant) {
	const availableMinerals = this.getCurrentResourceAmount(resourceType);

	if (!this.factory || !this.factory.isOperational() || this.isEvacuating()) return availableMinerals;

	// @todo Get resource unpacking factor from API or config.
	return availableMinerals + (Math.max(0, this.getCurrentResourceAmount(mineralBars[resourceType])) * 5);
}

/**
 * Decides whether a room's storage has too much energy.
 *
 * @return {boolean}
 *   True if storage limit for energy has been reached.
 */
Room.prototype.isFullOnEnergy = function (this: Room) {
	return this.getCurrentResourceAmount(RESOURCE_ENERGY) > this.getStorageLimit() / 2;
};

/**
 * Decides whether a room's storage has too much power.
 *
 * @return {boolean}
 *   True if storage limit for power has been reached.
 */
Room.prototype.isFullOnPower = function (this: Room) {
	return this.getCurrentResourceAmount(RESOURCE_POWER) > this.getStorageLimit() / 6;
};

/**
 * Decides whether a room's storage has too many minerals.
 *
 * @return {boolean}
 *   True if storage limit for minerals has been reached.
 */
Room.prototype.isFullOnMinerals = function (this: Room) {
	return this.getCurrentMineralAmount() > this.getStorageLimit() / 3;
};

/**
 * Decides whether a room's storage has too much of a resource.
 *
 * @param {string} resourceType
 *   Type of the resource we want to check.
 *
 * @return {boolean}
 *   True if storage limit for the resource has been reached.
 */
Room.prototype.isFullOn = function (this: Room, resourceType: ResourceConstant) {
	if (resourceType === RESOURCE_ENERGY) return this.isFullOnEnergy();
	if (resourceType === RESOURCE_POWER) return this.isFullOnPower();
	return this.isFullOnMinerals();
};

/**
 * Determines a room's storage location, where we drop energy as long as no
 * storage has been built yet.
 *
 * @return {RoomPosition}
 *   Returns the room's storage location.
 */
Room.prototype.getStorageLocation = function (this: Room) {
	if (!this.controller) return null;
	if (this.roomPlanner) return this.roomPlanner.getRoomCenter();

	return this.storage ? this.storage.pos : null;
};

/**
 * Saves the order to move a certain amount of resources to the terminal.
 *
 * @param {string} resourceType
 *   The type of resource to store.
 * @param {number} amount
 *   Amount of resources to store.
 */
Room.prototype.prepareForTrading = function (this: Room, resourceType: ResourceConstant, amount?: number) {
	if (!amount) amount = Math.min(10_000, this.getCurrentResourceAmount(resourceType));
	this.memory.fillTerminal = resourceType;
	this.memory.fillTerminalAmount = Math.min(amount, 50_000);
};

/**
 * Stops deliberately storing resources in the room's terminal.
 */
Room.prototype.stopTradePreparation = function (this: Room) {
	delete this.memory.fillTerminal;
	delete this.memory.fillTerminalAmount;
};

/**
 * Returns the position of all sources that should be remote harvested.
 *
 * @return {RoomPosition[]}
 *   An array of objects containing information about remote harvest targets.
 */
Room.prototype.getRemoteHarvestSourcePositions = function (this: Room) {
	return cache.inHeap('remoteSourcePositions:' + this.name, 500, () => {
		const evaluations: SourceEvaluation[] = [];
		_.each(Game.operationsByType.mining, operation => {
			const locations = operation.getMiningLocationsByRoom();

			_.each(locations[this.name], location => {
				if (!operation.getPaths()[location]?.path) return;

				evaluations.push(getRemoteHarvestSourceEvaluation(operation, location));
			});
		});

		// Sort by profitability because it influences spawn order.
		const harvestPositions: RoomPosition[] = [];
		for (const evaluation of _.sortBy(evaluations, evaluation => {
			// if (this.storage || this.terminal) return evaluation.averageDistance * (1.2 - (evaluation.sourceCount / 5));

			return evaluation.distance;
		})) {
			harvestPositions.push(decodePosition(evaluation.location));
		}

		return harvestPositions;
	});
};

function getRemoteHarvestSourceEvaluation(operation: RemoteMiningOperation, location: string): SourceEvaluation {
	const filteredPaths = _.filter(operation.getPaths(), path => path.path);

	return {
		location,
		sourceCount: _.size(filteredPaths),
		distance: operation.getPaths()[location].path.length,
		averageDistance: _.sum(filteredPaths, path => path.path.length) / _.size(filteredPaths),
	};
}

/**
 * Returns the position of all nearby controllers that should be reserved.
 *
 * @return {RoomPosition[]}
 *   An array of objects containing information about controller targets.
 */
Room.prototype.getRemoteReservePositions = function (this: Room) {
	const reservePositions: RoomPosition[] = [];
	// Add positions of nearby safe rooms.
	const safeRooms = this.roomPlanner ? this.roomPlanner.getAdjacentSafeRooms() : [];
	for (const roomName of safeRooms) {
		const position = getRoomIntel(roomName).getControllerPosition();
		if (!position) continue;

		reservePositions.push(position);
	}

	return reservePositions;
};

/**
 * Gathers resource amounts for a room.
 *
 * @return {object}
 *   An object containing information about this room's resources:
 *   - totalResources: Resource amounts keyed by resource type.
 *   - state: Resource thresholds, namely `low`, `medium`, `high` and
 *     `excessive` keyed by resource type.
 *   - canTrade: Whether the room can perform trades.
 */
Room.prototype.getResourceState = function (this: Room) {
	if (!this.isMine()) return null;

	const storage = this.storage;
	const terminal = this.terminal;

	return cache.inObject(this, 'resourceState', 1, () => {
		const roomData: RoomResourceState = {
			totalResources: {},
			state: {},
			canTrade: false,
			addResource(this: RoomResourceState, resourceType: ResourceConstant, amount: number) {
				this.totalResources[resourceType] = (this.totalResources[resourceType] || 0) + amount;
			},
			isEvacuating: false,
			mineralTypes: [],
		};

		// @todo Remove in favor of function.
		roomData.isEvacuating = this.isEvacuating();

		if (storage && !roomData.isEvacuating) {
			_.each(storage.store, (amount: number, resourceType: ResourceConstant) => {
				roomData.addResource(resourceType, amount);
			});
		}

		if (terminal) {
			roomData.canTrade = true;
			_.each(terminal.store, (amount: number, resourceType: ResourceConstant) => {
				roomData.addResource(resourceType, amount);
			});
		}

		if (this.factory) {
			_.each(this.factory.store, (amount: number, resourceType: ResourceConstant) => {
				roomData.addResource(resourceType, amount);
			});
		}

		if (!roomData.isEvacuating) {
			for (const mineral of this.minerals) {
				roomData.mineralTypes.push(mineral.mineralType);
			}
		}

		// Add resources in labs as well.
		if (this.memory.labs && !roomData.isEvacuating) {
			const labs = this.myStructuresByType[STRUCTURE_LAB] || [];

			for (const lab of labs) {
				if (lab.mineralType && lab.mineralAmount > 0) {
					roomData.addResource(lab.mineralType, lab.mineralAmount);
				}
			}
		}

		const resourceLevelManager = container.get('ResourceLevelManager');
		for (const resourceType of getResourcesIn(roomData.totalResources)) {
			roomData.state[resourceType] = resourceLevelManager.determineResourceLevel(this, roomData.totalResources[resourceType] || 0, resourceType);
		}

		return roomData;
	});
};

/**
 * Determines the best place to store resources.
 *
 * @param {number} amount
 *   Amount of resources to store.
 * @param {string} resourceType
 *   Type of resource to store.
 *
 * @return {Structure}
 *   The room's storage or terminal.
 */
Room.prototype.getBestStorageTarget = function (this: Room, amount, resourceType) {
	if (!this.storage || !this.terminal) return this.storage || this.terminal;

	return determineBestStorageTarget(this, amount, resourceType);
};

function determineBestStorageTarget(room: Room, amount: number, resourceType: ResourceConstant) {
	const storageFree = room.storage.store.getFreeCapacity();
	const terminalFree = room.terminal.store.getFreeCapacity();
	if (room.isEvacuating() && terminalFree > room.terminal.store.getCapacity() * 0.2) {
		// If we're evacuating, store everything in terminal to be sent away.
		return room.terminal;
	}

	if (room.isClearingTerminal() && storageFree > amount + 5000) {
		// If we're clearing out the terminal, put everything into storage.
		return room.storage;
	}

	if (room.isClearingStorage() && terminalFree > amount + (resourceType === RESOURCE_ENERGY ? 0 : 5000)) {
		// If we're clearing out the storage, put everything into terminal.
		return room.terminal;
	}

	if (resourceType === RESOURCE_ENERGY && room.terminal && room.terminal.store[RESOURCE_ENERGY] < 7000 && terminalFree > 0) {
		// Make sure terminal gets energy for transactions.
		return room.terminal;
	}

	if (storageFree >= amount && terminalFree >= amount && (room.storage.store[resourceType] || 0) / storageFree < (room.terminal.store[resourceType] || 0) / terminalFree) {
		return room.storage;
	}

	if (terminalFree >= amount) {
		return room.terminal;
	}

	if (storageFree >= amount) {
		return room.storage;
	}

	return null;
}

/**
 * Determines the best place to get resources from.
 *
 * @param {string} resourceType
 *   The type of resource to get.
 *
 * @return {Structure}
 *   The room's storage or terminal.
 */
Room.prototype.getBestStorageSource = function (this: Room, resourceType: ResourceConstant) {
	if (this.storage && this.terminal) {
		const specialSource = this.getBestCircumstancialStorageSource(resourceType);
		if (specialSource) return specialSource;

		if ((this.storage.store[resourceType] || 0) / this.storage.store.getCapacity() < (this.terminal.store[resourceType]) / this.terminal.store.getCapacity() && this.memory.fillTerminal !== resourceType) {
			return this.terminal;
		}

		if ((this.storage.store[resourceType] || 0) > 0) {
			return this.storage;
		}
	}
	else if (this.storage?.store[resourceType]) {
		return this.storage;
	}
	else if (this.terminal?.store[resourceType] && (!this.memory.fillTerminal || this.memory.fillTerminal !== resourceType)) {
		return this.terminal;
	}

	return null;
};

/**
 * Determines the best place to get resources from when special rules apply.
 *
 * This is the case when a room is evacuating or a terminal is being emptied.
 *
 * @param {string} resourceType
 *   The type of resource to get.
 *
 * @return {Structure}
 *   The room's storage or terminal.
 */
Room.prototype.getBestCircumstancialStorageSource = function (this: Room, resourceType: ResourceConstant) {
	let primarySource: StructureStorage | StructureTerminal;
	let secondarySource: StructureStorage | StructureTerminal;
	if (this.isEvacuating()) {
		// Take resources out of storage if possible to empty it out.
		primarySource = this.storage;
		secondarySource = this.terminal;
	}
	else if (this.isClearingTerminal()) {
		// Take resources out of terminal if possible to empty it out.
		primarySource = this.terminal;
		secondarySource = this.storage;
	}
	else {
		return null;
	}

	const secondaryFull = secondarySource.store.getUsedCapacity() > secondarySource.store.getCapacity() * 0.8;

	if (primarySource.store[resourceType] && (!secondaryFull || !secondarySource.store[resourceType])) {
		return primarySource;
	}

	if (secondarySource.store[resourceType] && (resourceType === RESOURCE_ENERGY || secondaryFull)) {
		return secondarySource;
	}

	return null;
};

/**
 * Checks if a keeper lair is considered dangerous.
 *
 * @return {boolean}
 *   True if a source keeper is spawned or about to spawn.
 */
StructureKeeperLair.prototype.isDangerous = function (this: StructureKeeperLair) {
	if (_.some(this.room.enemyCreeps['Source Keeper'], c => c.pos.getRangeTo(this) <= 5)) return true;

	return !this.ticksToSpawn || this.ticksToSpawn < 20;
};

/**
 * Checks if being close to this source is currently dangerous.
 *
 * @return {boolean}
 *   True if an active keeper lair is nearby and we have no defenses.
 */
const isDangerous = function (this: Source | Mineral): boolean {
	const lair = this.getNearbyLair();
	if (!lair || !lair.isDangerous()) return false;

	// It's still safe if a guardian with sufficient lifespan is nearby to take
	// care of any source keepers, and the lair isn't too close to the source.
	if (this.room.creepsByRole.skKiller && lair.pos.getRangeTo(this) > 4) {
		for (const guardian of _.values<SkKillerCreep>(this.room.creepsByRole.skKiller)) {
			if (lair.pos.getRangeTo(guardian) < 5 && guardian.ticksToLive > 30) {
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
Source.prototype.isDangerous = function (this: Source) {
	return isDangerous.call(this);
};

/**
 * Checks if being close to this mineral is currently dangerous.
 *
 * @return {boolean}
 *   True if an active keeper lair is nearby and we have no defenses.
 */
Mineral.prototype.isDangerous = function (this: Mineral) {
	return isDangerous.call(this);
};
