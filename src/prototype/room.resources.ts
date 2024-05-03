/* global Room RoomPosition RESOURCE_ENERGY LOOK_RESOURCES
RESOURCE_POWER STRUCTURE_LAB RESOURCES_ALL */

import cache from 'utils/cache';
import container from 'utils/container';
import RemoteMiningOperation from 'operation/remote-mining';
import ResourceDestinationDispatcher from 'dispatcher/resource-destination/dispatcher';
import ResourceSourceDispatcher from 'dispatcher/resource-source/dispatcher';
import {decodePosition} from 'utils/serialization';
import {ENEMY_STRENGTH_NORMAL} from 'room-defense';
import {getRoomIntel} from 'room-intel';

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
		determineResourceLevel: (amount: number, resourceType: ResourceConstant) => ResourceLevel;
		getResourceLevelCutoffs: (resourceType: ResourceConstant) => ResourceLevelCuttoffs;
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
Room.prototype.getCurrentResourceAmount = function (this: Room, resourceType: string): number {
	let total = 0;
	if (this.storage && this.storage.store[resourceType]) {
		total += this.storage.store[resourceType];
	}

	if (this.terminal && this.terminal.store[resourceType]) {
		total += this.terminal.store[resourceType];
	}

	/* If (this.factory && this.factory.store[resourceType]) {
		total += this.factory.store[resourceType];
	} */

	// Add resources in transporters to prevent fluctuation from transporters
	// moving stuff around.
	_.each(this.creepsByRole.transporter, creep => {
		total += creep.store.getUsedCapacity(resourceType as ResourceConstant);
	});

	if (!this.terminal && !this.storage) {
		// Until a storage is built, haulers effectively act as transporters.
		_.each(this.creepsByRole.hauler, creep => {
			total += creep.store.getUsedCapacity(resourceType as ResourceConstant);
		});
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
	// @todo This could use caching.
	let total = 0;

	for (const resourceType of RESOURCES_ALL) {
		if (resourceType === RESOURCE_ENERGY || resourceType === RESOURCE_POWER) continue;
		total += this.getCurrentResourceAmount(resourceType);
	}

	return total;
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
	return availableEnergy + Math.max(0, this.getCurrentResourceAmount(RESOURCE_BATTERY) - 5000) * 5;
};

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
	// @todo Sort by profitability because it influences spawn order.
	return cache.inHeap('remoteSourcePositions:' + this.name, 500, () => {
		const evaluations = [];
		_.each(Game.operationsByType.mining, operation => {
			const locations = operation.getMiningLocationsByRoom();

			_.each(locations[this.name], location => {
				if (!operation.getPaths()[location]?.path) return;

				evaluations.push(getRemoteHarvestSourceEvaluation(operation, location));
			});
		});

		const harvestPositions: RoomPosition[] = [];
		for (const evaluation of _.sortBy(evaluations, evaluation => {
			if (this.storage || this.terminal) return evaluation.averageDistance * (1.2 - (evaluation.sourceCount / 5));

			return evaluation.distance;
		})) {
			harvestPositions.push(decodePosition(evaluation.location));
		}

		return harvestPositions;
	});
};

function getRemoteHarvestSourceEvaluation(operation: RemoteMiningOperation, location: string) {
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
	if (!this.isMine()) return null;

	const storage = this.storage;
	const terminal = this.terminal;

	return cache.inObject(this, 'resourceState', 1, () => {
		const roomData: RoomResourceState = {
			totalResources: {},
			state: {},
			canTrade: false,
			addResource(resourceType: ResourceConstant, amount: number) {
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
};

Room.prototype.getResourceLevelCutoffs = function (this: Room, resourceType: ResourceConstant): ResourceLevelCuttoffs {
	if (resourceType === RESOURCE_ENERGY) {
		// Defending rooms need energy to defend.
		if (this.defense.getEnemyStrength() >= ENEMY_STRENGTH_NORMAL) return [1_000_000, 100_000, 50_000];

		// Rooms we are funneling should pull extra energy.
		const funnelManager = container.get('FunnelManager');
		if (funnelManager.isFunnelingTo(this.name)) return [500_000, 300_000, 150_000];

		return [200_000, 50_000, 20_000];
	}

	if (resourceType === RESOURCE_POWER) {
		// Only rooms with power spawns need power.
		if (!this.powerSpawn) return [1, 0, 0];
		return [50_000, 30_000, 10_000];
	}

	if (resourceType === RESOURCE_OPS) {
		// Only rooms with power creeps need ops.
		if (_.filter(Game.powerCreeps, c => c.pos && c.pos.roomName === this.name).length === 0) return [1, 0, 0];
		return [10_000, 5000, 1000];
	}

	// @todo If the room has a factory, consolidate normal resources and bars.

	// Basic commodities need a factory.
	if (([RESOURCE_SILICON, RESOURCE_METAL, RESOURCE_BIOMASS, RESOURCE_MIST] as string[]).includes(resourceType)) {
		if (!this.factory) return [1, 0, 0];
		return [30_000, 10_000, 2000];
	}

	// @todo For commodities, ignore anything we don't need for recipes of the
	// current factory level.
	if (
		([
			RESOURCE_COMPOSITE,
			RESOURCE_CRYSTAL,
			RESOURCE_LIQUID,
			RESOURCE_WIRE,
			RESOURCE_SWITCH,
			RESOURCE_TRANSISTOR,
			RESOURCE_MICROCHIP,
			RESOURCE_CIRCUIT,
			RESOURCE_DEVICE,
			RESOURCE_CELL,
			RESOURCE_PHLEGM,
			RESOURCE_TISSUE,
			RESOURCE_MUSCLE,
			RESOURCE_ORGANOID,
			RESOURCE_ORGANISM,
			RESOURCE_ALLOY,
			RESOURCE_TUBE,
			RESOURCE_FIXTURES,
			RESOURCE_FRAME,
			RESOURCE_HYDRAULICS,
			RESOURCE_MACHINE,
			RESOURCE_CONDENSATE,
			RESOURCE_CONCENTRATE,
			RESOURCE_EXTRACT,
			RESOURCE_SPIRIT,
			RESOURCE_EMANATION,
			RESOURCE_ESSENCE,
		] as string[]).includes(resourceType)
	) {
		if (!this.factory) return [1, 0, 0];
		if (!isCommodityNeededAtFactoryLevel(this.factory.getEffectiveLevel(), resourceType)) return [1, 0, 0];
		return [10_000, 5000, 500];
	}

	// For boosts, try to have a minimum amount for all types. Later, make
	// dependent on room military state and so on.
	// @todo If there's no labs, we don't need boosts.
	for (const bodyPart in BOOSTS) {
		if (!BOOSTS[bodyPart][resourceType]) continue;

		if ((bodyPart === ATTACK || bodyPart === RANGED_ATTACK) && this.defense.getEnemyStrength() > ENEMY_STRENGTH_NORMAL) return [15_000, 7500, 2500];
		if (bodyPart === WORK && BOOSTS[bodyPart][resourceType].repair && this.defense.getEnemyStrength() > ENEMY_STRENGTH_NORMAL) return [15_000, 7500, 2500];
		if (bodyPart === WORK && BOOSTS[bodyPart][resourceType].upgradeController && this.controller.level >= 8) return [15_000, 7500, 2500];
	}

	const reaction = this.memory.currentReaction;
	if (reaction && (resourceType === reaction[0] || resourceType === reaction[1])) {
		// Make sure we request enough resources of this type to perform reactions.
		return [50_000, 30_000, 10_000];
	}

	// Any other resources, we can store but don't need.
	return [50_000, 0, 0];
};

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
Room.prototype.getBestStorageTarget = function (this: Room, amount, resourceType) {
	if (this.storage && this.terminal) {
		const storageFree = this.storage.store.getFreeCapacity();
		const terminalFree = this.terminal.store.getFreeCapacity();
		if (this.isEvacuating() && terminalFree > this.terminal.store.getCapacity() * 0.2) {
			// If we're evacuating, store everything in terminal to be sent away.
			return this.terminal;
		}

		if (this.isClearingTerminal() && storageFree > amount + 5000) {
			// If we're clearing out the terminal, put everything into storage.
			return this.storage;
		}

		if (this.isClearingStorage() && terminalFree > amount + (resourceType == RESOURCE_ENERGY ? 0 : 5000)) {
			// If we're clearing out the storage, put everything into terminal.
			return this.terminal;
		}

		if (!resourceType) {
			if (this.storage.store.getUsedCapacity() / this.storage.store.getCapacity() < this.terminal.store.getUsedCapacity() / this.terminal.store.getCapacity()) {
				return this.storage;
			}

			return this.terminal;
		}

		if (resourceType === RESOURCE_ENERGY && this.terminal && this.terminal.store[RESOURCE_ENERGY] < 7000 && terminalFree > 0) {
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

	return null;
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
	else if (this.storage && this.storage.store[resourceType]) {
		return this.storage;
	}
	else if (this.terminal && this.terminal.store[resourceType] && (!this.memory.fillTerminal || this.memory.fillTerminal !== resourceType)) {
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

	return !this.ticksToSpawn || this.ticksToSpawn < 10;
};

/**
 * Checks if being close to this source is currently dangerous.
 *
 * @return {boolean}
 *   True if an active keeper lair is nearby and we have no defenses.
 */
const isDangerous = function (this: Source | Mineral) {
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
