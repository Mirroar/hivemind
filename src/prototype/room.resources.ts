/* global Room RoomPosition RESOURCE_ENERGY LOOK_RESOURCES
RESOURCE_POWER FIND_STRUCTURES STRUCTURE_LAB RESOURCES_ALL */

declare global {
	interface Room {
		sourceDispatcher: ResourceSourceDispatcher;
		destinationDispatcher: ResourceDestinationDispatcher;
		getStorageLimit: () => number;
		getFreeStorage;
		getCurrentResourceAmount: (resourceType: string) => number;
		getStoredEnergy: () => number;
		getCurrentMineralAmount;
		isFullOnEnergy: () => boolean;
		isFullOnPower: () => boolean;
		isFullOnMinerals: () => boolean;
		isFullOn;
		getStorageLocation: () => RoomPosition;
		prepareForTrading;
		stopTradePreparation;
		getRemoteHarvestSourcePositions;
		getRemoteReservePositions;
		getResourceState;
		getBestStorageTarget: (amount: number, resourceType: string) => AnyStoreStructure;
		getBestStorageSource: (resourceType: string) => AnyStoreStructure;
		getBestCircumstancialStorageSource;
		determineResourceLevel;
		getResourceLevelCutoffs;
	}

	interface RoomMemory {
		fillTerminalAmount;
	}
}

import cache from 'utils/cache';
import ResourceDestinationDispatcher from 'dispatcher/resource-destination/dispatcher';
import ResourceSourceDispatcher from 'dispatcher/resource-source/dispatcher';
import {decodePosition} from 'utils/serialization';
import {getRoomIntel} from 'room-intel';

// Define quick access property room.sourceDispatcher.
Object.defineProperty(Room.prototype, 'sourceDispatcher', {
	get(this: Room) {
		return cache.inObject(this, 'sourceDispatcher', 1, () => {
			return new ResourceSourceDispatcher(this);
		})
	},
	enumerable: false,
	configurable: true,
});

// Define quick access property room.destinationDispatcher.
Object.defineProperty(Room.prototype, 'destinationDispatcher', {
	get(this: Room) {
		return cache.inObject(this, 'destinationDispatcher', 1, () => {
			return new ResourceDestinationDispatcher(this);
		})
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
	if (this.storage) {
		total += this.storage.store.getCapacity();
	}
	else {
		// Assume 10000 storage for dropping stuff on the ground.
		total += 10000;
	}

	if (this.terminal) {
		total += this.terminal.store.getCapacity();
	}

	return total;
};

/**
 * Determines amount of currently available storage.
 *
 * @return {number}
 *   The currently available free storage space.
 */
Room.prototype.getFreeStorage = function () {
	// Determines amount of free space in storage.
	let limit = this.getStorageLimit();
	if (this.storage) {
		limit -= this.storage.store.getUsedCapacity();
	}

	if (this.terminal) {
		limit -= this.terminal.store.getUsedCapacity();
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
Room.prototype.getCurrentResourceAmount = function (this: Room, resourceType: string): number {
	let total = 0;
	if (this.storage && this.storage.store[resourceType]) {
		total += this.storage.store[resourceType];
	}

	if (this.terminal && this.terminal.store[resourceType]) {
		total += this.terminal.store[resourceType];
	}

	if (this.factory && this.factory.store[resourceType]) {
		total += this.factory.store[resourceType];
	}

	return total;
};

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
		const harvestPositions = this.roomPlanner && this.roomPlanner.getLocations('harvester');
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

		return total;
	});
};

/**
 * Gets amount of minerals and mineral compounds stored in a room.
 *
 * @return {number}
 *   Amount of minerals stored in this room.
 */
Room.prototype.getCurrentMineralAmount = function () {
	// @todo This could use caching.
	let total = 0;

	for (const resourceType of RESOURCES_ALL) {
		if (resourceType === RESOURCE_ENERGY || resourceType === RESOURCE_POWER) continue;
		total += this.getCurrentResourceAmount(resourceType);
	}

	return total;
};

/**
 * Decides whether a room's storage has too much energy.
 *
 * @return {boolean}
 *   True if storage limit for energy has been reached.
 */
Room.prototype.isFullOnEnergy = function () {
	return this.getCurrentResourceAmount(RESOURCE_ENERGY) > this.getStorageLimit() / 2;
};

/**
 * Decides whether a room's storage has too much power.
 *
 * @return {boolean}
 *   True if storage limit for power has been reached.
 */
Room.prototype.isFullOnPower = function () {
	return this.getCurrentResourceAmount(RESOURCE_POWER) > this.getStorageLimit() / 6;
};

/**
 * Decides whether a room's storage has too many minerals.
 *
 * @return {boolean}
 *   True if storage limit for minerals has been reached.
 */
Room.prototype.isFullOnMinerals = function () {
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
Room.prototype.isFullOn = function (resourceType) {
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
Room.prototype.prepareForTrading = function (this: Room, resourceType: ResourceConstant, amount: number) {
	if (!amount) amount = Math.min(10000, this.getCurrentResourceAmount(resourceType));
	this.memory.fillTerminal = resourceType;
	this.memory.fillTerminalAmount = Math.min(amount, 50000);
};

/**
 * Stops deliberately storing resources in the room's terminal.
 */
Room.prototype.stopTradePreparation = function () {
	delete this.memory.fillTerminal;
	delete this.memory.fillTerminalAmount;
};

/**
 * Returns the position of all sources that should be remote harvested.
 *
 * @return {RoomPosition[]}
 *   An array of objects containing information about remote harvest targets.
 */
Room.prototype.getRemoteHarvestSourcePositions = function () {
	const harvestPositions = [];
	_.each(Game.operationsByType.mining, operation => {
		const locations = operation.getMiningLocationsByRoom();

		_.each(locations[this.name], location => {
			harvestPositions.push(decodePosition(location));
		});
	});

	return harvestPositions;
};

/**
 * Returns the position of all nearby controllers that should be reserved.
 *
 * @return {RoomPosition[]}
 *   An array of objects containing information about controller targets.
 */
Room.prototype.getRemoteReservePositions = function () {
	const reservePositions = [];
	_.each(Game.operationsByType.mining, operation => {
		const roomName = operation.getClaimerSourceRoom();
		if (this.name !== roomName) return;

		const position = getRoomIntel(operation.getRoom()).getControllerPosition();
		if (!position) return;

		reservePositions.push(position);
	});

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
	if (!this.isMine()) return {};

	const storage = this.storage;
	const terminal = this.terminal;

	return cache.inObject(this, 'resourceState', 1, () => {
		const roomData = {
			totalResources: {},
			state: {},
			canTrade: false,
			addResource(resourceType, amount) {
				this.totalResources[resourceType] = (this.totalResources[resourceType] || 0) + amount;
			},
			isEvacuating: false,
			mineralType: null,
		};
		if (storage && terminal) {
			roomData.canTrade = true;
		}

		// @todo Remove in favor of function.
		roomData.isEvacuating = this.isEvacuating();

		if (storage && !roomData.isEvacuating) {
			_.each(storage.store, (amount, resourceType) => {
				roomData.addResource(resourceType, amount);
			});
		}

		if (terminal) {
			_.each(terminal.store, (amount, resourceType) => {
				roomData.addResource(resourceType, amount);
			});
		}

		if (this.factory) {
			_.each(this.factory.store, (amount, resourceType) => {
				roomData.addResource(resourceType, amount);
			});
		}

		if (this.mineral && !roomData.isEvacuating) {
			roomData.mineralType = this.mineral.mineralType;
		}

		// Add resources in labs as well.
		if (this.memory.labs && !roomData.isEvacuating) {
			const labs = this.find<StructureLab>(FIND_STRUCTURES, {filter: s => s.structureType === STRUCTURE_LAB});

			for (const lab of labs) {
				if (lab.mineralType && lab.mineralAmount > 0) {
					roomData.addResource(lab.mineralType, lab.mineralAmount);
				}
			}
		}

		for (const resourceType of RESOURCES_ALL) {
			roomData.state[resourceType] = this.determineResourceLevel(roomData.totalResources[resourceType] || 0, resourceType);
		}

		return roomData;
	});
};

type ResourceLevel = 'low' | 'medium' | 'high' | 'excessive';
type ResourceLevelCuttoffs = [number, number, number];

Room.prototype.determineResourceLevel = function (this: Room, amount: number, resourceType: ResourceConstant): ResourceLevel {
	const cutoffs = this.getResourceLevelCutoffs(resourceType);
	if (amount >= cutoffs[0]) return 'excessive';
	if (amount >= cutoffs[1]) return 'high';
	if (amount >= cutoffs[2]) return 'medium';
	return 'low';
}

Room.prototype.getResourceLevelCutoffs = function (this: Room, resourceType: ResourceConstant): ResourceLevelCuttoffs {
	if (resourceType === RESOURCE_ENERGY) {
		// Defending rooms need energy to defend.
		if (this.defense.getEnemyStrength() > 0) return [1000000, 100000, 50000];
		return [200000, 50000, 20000];
	}

	if (resourceType === RESOURCE_POWER) {
		// Only rooms with power spawns need power.
		if (!this.powerSpawn) return [1, 1, 0];
		return [50000, 30000, 10000];
	}

	if (resourceType === RESOURCE_OPS) {
		// Only rooms with power creeps need ops.
		if (_.filter(Game.powerCreeps, c => c.pos && c.pos.roomName === this.name).length === 0) return [1, 1, 0];
		return [10000, 5000, 1000];
	}

	// @todo If the room has a factory, consolidate normal resources and bars.

	// Basic commodities need a factory.
	if (([RESOURCE_SILICON, RESOURCE_METAL, RESOURCE_BIOMASS, RESOURCE_MIST] as string[]).includes(resourceType)) {
		if (!this.factory) return [1, 1, 0];
		return [30000, 10000, 2000];
	}

	// @todo For commodities, ignore anything we don't need for recipes of the
	// current factory level.
	if (
		([
			RESOURCE_COMPOSITE, RESOURCE_CRYSTAL, RESOURCE_LIQUID,
			RESOURCE_WIRE, RESOURCE_SWITCH, RESOURCE_TRANSISTOR, RESOURCE_MICROCHIP, RESOURCE_CIRCUIT, RESOURCE_DEVICE,
			RESOURCE_CELL, RESOURCE_PHLEGM, RESOURCE_TISSUE, RESOURCE_MUSCLE, RESOURCE_ORGANOID, RESOURCE_ORGANISM,
			RESOURCE_ALLOY, RESOURCE_TUBE, RESOURCE_FIXTURES, RESOURCE_FRAME, RESOURCE_HYDRAULICS, RESOURCE_MACHINE,
			RESOURCE_CONDENSATE, RESOURCE_CONCENTRATE, RESOURCE_EXTRACT, RESOURCE_SPIRIT, RESOURCE_EMANATION, RESOURCE_ESSENCE,
		] as string[]).includes(resourceType)
	) {
		if (!this.factory) return [1, 1, 0];
		if (!isCommodityNeededAtFactoryLevel(this.factory.getEffectiveLevel(), resourceType)) return [1, 1, 0];
		return [10000, 5000, 500];
	}

	// @todo For boosts, try to have a minimum amount for all types. Later, make
	// dependent on room military state and so on.

	return [50000, 30000, 10000];
}

function isCommodityNeededAtFactoryLevel(factoryLevel: number, resourceType: ResourceConstant): boolean {
	for (const productType in COMMODITIES) {
		const recipe = COMMODITIES[productType];
		if (recipe.level && recipe.level !== factoryLevel) continue;
		if (recipe.components[resourceType]) return true;
	}

	return false;
}

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
Room.prototype.getBestStorageTarget = function (amount, resourceType) {
	if (this.storage && this.terminal) {
		const storageFree = this.storage.store.getFreeCapacity();
		const terminalFree = this.terminal.store.getFreeCapacity();
		if (this.isEvacuating() && terminalFree > this.terminal.store.getCapacity() * 0.2) {
			// If we're evacuating, store everything in terminal to be sent away.
			return this.terminal;
		}

		if (this.isClearingTerminal() && storageFree > this.storage.store.getCapacity() * 0.2) {
			// If we're clearing out the terminal, put everything into storage.
			return this.storage;
		}

		if (this.isClearingStorage() && terminalFree > this.terminal.store.getCapacity() * 0.2) {
			// If we're clearing out the storage, put everything into terminal.
			return this.terminal;
		}

		if (!resourceType) {
			if (this.storage.store.getUsedCapacity() / this.storage.store.getCapacity() < this.terminal.store.getUsedCapacity() / this.terminal.store.getCapacity()) {
				return this.storage;
			}

			return this.terminal;
		}

		if (resourceType === RESOURCE_ENERGY && this.terminal && this.terminal.store[RESOURCE_ENERGY] < 5000) {
			// Make sure terminal has energy for transactions.
			return this.terminal;
		}

		if (storageFree >= amount && terminalFree >= amount && (this.storage.store[resourceType] || 0) / storageFree < (this.terminal.store[resourceType] || 0) / terminalFree) {
			return this.storage;
		}

		if (terminalFree >= amount) {
			return this.terminal;
		}

		if (storageFree >= amount) {
			return this.storage;
		}
	}
	else if (this.storage) {
		return this.storage;
	}
	else if (this.terminal) {
		return this.terminal;
	}
};

/**
 * Determines the best place to get resources from.
 *
 * @param {string} resourceType
 *   The type of resource to get.
 *
 * @return {Structure}
 *   The room's storage or terminal.
 */
Room.prototype.getBestStorageSource = function (resourceType) {
	if (this.storage && this.terminal) {
		const specialSource = this.getBestCircumstancialStorageSource(resourceType);
		if (specialSource) return specialSource;

		if ((this.storage.store[resourceType] || 0) / this.storage.store.getCapacity() < (this.terminal.store[resourceType]) / this.terminal.store.getCapacity()) {
			if (this.memory.fillTerminal !== resourceType) {
				return this.terminal;
			}
		}

		if ((this.storage.store[resourceType] || 0) > 0) {
			return this.storage;
		}
	}
	else if (this.storage && this.storage.store[resourceType]) {
		return this.storage;
	}
	else if (this.terminal && this.terminal.store[resourceType] && this.memory.fillTerminal !== resourceType) {
		return this.terminal;
	}
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
Room.prototype.getBestCircumstancialStorageSource = function (resourceType) {
	let primarySource;
	let secondarySource;
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

	if (primarySource) {
		const secondaryFull = secondarySource.store.getUsedCapacity() > secondarySource.store.getCapacity() * 0.8;

		if (primarySource.store[resourceType] && (!secondaryFull || !secondarySource.store[resourceType])) {
			return primarySource;
		}

		if (secondarySource.store[resourceType] && (resourceType === RESOURCE_ENERGY || secondaryFull)) {
			return secondarySource;
		}
	}
};
