/* global PathFinder Room RoomPosition FIND_DROPPED_RESOURCES
STRUCTURE_CONTAINER RESOURCE_POWER RESOURCE_GHODIUM STRUCTURE_LAB REACTIONS
STRUCTURE_EXTENSION STRUCTURE_SPAWN STRUCTURE_TOWER STRUCTURE_NUKER ERR_NO_PATH
STRUCTURE_POWER_SPAWN TERRAIN_MASK_WALL LOOK_STRUCTURES RESOURCE_ENERGY
LOOK_CONSTRUCTION_SITES FIND_STRUCTURES OK OBSTACLE_OBJECT_TYPES ORDER_SELL
FIND_TOMBSTONES FIND_RUINS */

import balancer from 'excess-energy-balancer';
import Bay from 'manager.bay';

import Role from 'role/role';
import utilities from 'utilities';
import {getResourcesIn} from 'utils/store';
import {handleMapArea} from 'utils/map';

type TransporterDropOrderOption = {
	priority: number;
	weight: number;
	type: 'drop';
	resourceType: ResourceConstant;
}

type TransporterStructureOrderOption = {
	priority: number;
	weight: number;
	type: 'structure';
	object: AnyStoreStructure;
	resourceType: ResourceConstant;
}

type TransporterTombstoneOrderOption = {
	priority: number;
	weight: number;
	type: 'tombstone';
	object: Ruin | Tombstone;
	resourceType: ResourceConstant;
}

type TransporterPickupOrderOption = {
	priority: number;
	weight: number;
	type: 'resource';
	object: Resource;
	resourceType: ResourceConstant;
}

type TransporterBayOrderOption = {
	priority: number;
	weight: number;
	type: 'bay';
	object: Bay;
	resourceType: ResourceConstant;
}

type TransporterPositionOrderOption = {
	priority: number;
	weight: number;
	type: 'position',
	object: RoomPosition,
	resourceType: ResourceConstant,
}

type TransporterDestinationOrderOption = ResourceDestinationTask | TransporterDropOrderOption | TransporterStructureOrderOption | TransporterBayOrderOption | TransporterPositionOrderOption;

type TransporterSourceOrderOption = ResourceSourceTask | TransporterStructureOrderOption | TransporterPickupOrderOption | TransporterTombstoneOrderOption;

type TransporterGetEnergyOrder = {
	type: 'getEnergy' | 'getResource';
	target: Id<AnyStoreStructure | Resource | Ruin | Tombstone>;
	resourceType: ResourceConstant;
}

type TransporterDeliverOrder = {
	type: 'deliver';
	target: Id<AnyStoreStructure>;
	resourceType: ResourceConstant;
}

type TransporterBayOrder = {
	type: 'bay';
	name: string;
	resourceType: ResourceConstant;
}

type TransporterPositionOrder = {
	type: 'position';
	resourceType: ResourceConstant;
	x: number;
	y: number;
}

type TransporterOrder = TransporterGetEnergyOrder | TransporterDeliverOrder | TransporterBayOrder | TransporterPositionOrder | ResourceSourceTask | ResourceDestinationTask;

declare global {
	interface TransporterCreep extends Creep {
		role: 'transporter';
		memory: TransporterCreepMemory;
		heapMemory: TransporterCreepHeapMemory;
	}

	interface TransporterCreepMemory extends CreepMemory {
		role: 'transporter';
		delivering?: boolean;
		order?: TransporterOrder;
		blockedPathCounter?: number;
	}

	interface TransporterCreepHeapMemory extends CreepHeapMemory {
	}
}

function isPositionOrderOption(order: TransporterDestinationOrderOption): order is TransporterPositionOrderOption {
	return order.type == 'position';
}

function isDropOrderOption(order: TransporterDestinationOrderOption): order is TransporterDropOrderOption {
	return order.type == 'drop';
}

function isBayOrderOption(order: TransporterDestinationOrderOption): order is TransporterBayOrderOption {
	return order.type == 'bay';
}

function isResourceDestinationOrder(room: Room, order: TransporterOrder): order is ResourceDestinationTask {
	if ('type' in order && room.destinationDispatcher.hasProvider(order.type)) {
		return true;
	}

	return false;
}

function isTargettedDestinationOrder(order: ResourceDestinationTask): order is FactoryDestinationTask {
	return 'target' in order;
}

function isResourceSourceOrder(room: Room, order: TransporterOrder): order is ResourceSourceTask {
	if ('type' in order && room.sourceDispatcher.hasProvider(order.type)) {
		return true;
	}

	return false;
}

function isTargettedSourceOrder(order: ResourceSourceTask): order is FactorySourceTask | StorageSourceTask {
	return 'target' in order;
}

function isBayOrder(order: TransporterOrder): order is TransporterBayOrder {
	return order.type == 'bay';
}

function isPositionOrder(order: TransporterOrder): order is TransporterPositionOrder {
	return order.type == 'position';
}

function isCollectOrder(order: TransporterOrder): order is TransporterGetEnergyOrder {
	return order.type == 'getEnergy' || order.type == 'getResource';
}

function isDeliverOrder(order: TransporterOrder): order is TransporterDeliverOrder {
	return order.type == 'deliver';
}

export default class TransporterRole extends Role {
	creep: TransporterCreep;

	constructor() {
		super();

		// Make sure transporters always run at least a little.
		this.stopAt = 0;
		this.throttleAt = 5000;
	}

	/**
	 * Makes this creep behave like a transporter.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: TransporterCreep) {
		this.creep = creep;

		if (creep.memory.singleRoom) {
			if (creep.memory.order && 'target' in creep.memory.order) {
				const target = Game.getObjectById<RoomObject>(creep.memory.order.target);
				if (target && target.pos && target.pos.roomName !== creep.memory.singleRoom) {
					this.setTransporterState(creep.memory.delivering);
				}
			}
		}

		if (creep.store.getUsedCapacity() >= creep.store.getCapacity() * 0.9 && !creep.memory.delivering) {
			this.setTransporterState(true);
		}
		else if (creep.store.getUsedCapacity() <= creep.store.getCapacity() * 0.1 && creep.memory.delivering) {
			// @todo Don't switch state if we're currently filling a bay.
			this.setTransporterState(false);
		}

		if (this.bayUnstuck()) return;

		if (creep.memory.delivering) {
			this.performDeliver();
			return;
		}

		// Make sure not to keep standing on resource drop stop.
		const storagePosition = creep.room.getStorageLocation();
		if (!creep.room.storage && storagePosition && creep.pos.x === storagePosition.x && creep.pos.y === storagePosition.y && (!creep.memory.order || !('target' in creep.memory.order))) {
			creep.move(_.random(1, 8) as DirectionConstant);
			return;
		}

		this.performGetResources();
	}

	/**
	 * Puts this creep into or out of delivery mode.
	 *
	 * @param {boolean} delivering
	 *   Whether this creep is delivering resources instead of collecting.
	 */
	setTransporterState(delivering: boolean) {
		this.creep.memory.delivering = delivering;
		delete this.creep.memory.order;
	}

	/**
	 * Makes sure creeps don't get stuck in bays.
	 *
	 * @return {boolean}
	 *   True if the creep is trying to get free.
	 */
	bayUnstuck(): boolean {
		const creep = this.creep;
		// If the creep is in a bay, but not delivering to that bay (any more), make it move out of the bay forcibly.
		for (const bay of creep.room.bays) {
			if (creep.pos.x !== bay.pos.x || creep.pos.y !== bay.pos.y) continue;
			if (bay.isBlocked()) continue;

			// It's fine if we're explicitly delivering to this bay right now.
			if (creep.memory.order && isBayOrder(creep.memory.order) && creep.memory.order.name === bay.name) continue;

			// We're standing in a bay that we're not delivering to.
			const terrain = new Room.Terrain(creep.pos.roomName);
			// @todo Bay's available tiles should by handled and cached by the bay itself.
			const availableTiles: RoomPosition[] = [];
			handleMapArea(creep.pos.x, creep.pos.y, (x, y) => {
				if (x === creep.pos.x && y === creep.pos.y) return;
				if (terrain.get(x, y) === TERRAIN_MASK_WALL) return;

				const pos = new RoomPosition(x, y, creep.pos.roomName);

				// Check if there's a structure here already.
				const structures = pos.lookFor(LOOK_STRUCTURES);
				if (_.some(structures, structure => _.contains(OBSTACLE_OBJECT_TYPES, structure.structureType))) return;

				// Check if there's a construction site here already.
				const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
				if (_.some(sites, site => _.contains(OBSTACLE_OBJECT_TYPES, site.structureType))) return;

				// Move out of the way.
				availableTiles.push(pos);
			});

			if (availableTiles.length === 1) {
				const dir = creep.pos.getDirectionTo(availableTiles[0]);
				creep.move(dir);
				return true;
			}
		}

		return false;
	}

	/**
	 * Makes this creep deliver carried energy somewhere.
	 */
	performDeliver() {
		const creep = this.creep;

		if (!this.ensureValidDeliveryTarget()) {
			delete creep.memory.order;
			return;
		}

		if (
			isResourceDestinationOrder(creep.room, creep.memory.order) && isTargettedDestinationOrder(creep.memory.order)
			|| isDeliverOrder(creep.memory.order)
		) {
			const target = Game.getObjectById(creep.memory.order.target);
			creep.whenInRange(1, target, () => {
				creep.transfer(target, creep.memory.order.resourceType);
				delete creep.memory.order;
			});
			return;
		}

		if (isBayOrder(creep.memory.order)) {
			const target = _.find(creep.room.bays, bay => bay.name === (creep.memory.order as TransporterBayOrder).name);
			creep.whenInRange(0, target.pos, () => {
				target.refillFrom(creep);
			});
			return;
		}

		if (isPositionOrder(creep.memory.order)) {
			// Dropoff location.
			if (creep.pos.x === creep.memory.order.x && creep.pos.y === creep.memory.order.y) {
				creep.drop(creep.memory.order.resourceType);
			}
			else {
				const result = creep.moveTo(creep.memory.order.x, creep.memory.order.y);
				if (result === ERR_NO_PATH) {
					if (!creep.memory.blockedPathCounter) {
						creep.memory.blockedPathCounter = 0;
					}

					creep.memory.blockedPathCounter++;

					if (creep.memory.blockedPathCounter > 10) {
						this.calculateDeliveryTarget();
					}
				}
				else {
					delete creep.memory.blockedPathCounter;
				}
			}

			return;
		}

		// Unknown target type, reset!
		hivemind.log('default').error('Unknown target type for delivery found!', JSON.stringify(creep.memory.order.type));
	}

	/**
	 * Makes sure the creep has a valid target for resource delivery.
	 *
	 * @return {boolean}
	 *   True if the target is valid and can receive the needed resource.
	 */
	ensureValidDeliveryTarget(): boolean {
		const creep = this.creep;

		if (!creep.memory.order) this.calculateDeliveryTarget();
		if (!creep.memory.order) return false;

		const resourceType = creep.memory.order.resourceType;
		if ((creep.store[resourceType] || 0) <= 0) return false;

		if (isResourceDestinationOrder(creep.room, creep.memory.order)) {
			return creep.room.destinationDispatcher.validateTask(creep.memory.order);
		}

		if (isBayOrder(creep.memory.order)) {
			const target = _.find(creep.room.bays, bay => bay.name === (creep.memory.order as TransporterBayOrder).name);
			if (!target) return false;
			if (target.hasHarvester()) return false;

			return target.energy < target.energyCapacity;
		}
		else if (isPositionOrder(creep.memory.order)) {
			return true;
		}

		if (isDeliverOrder(creep.memory.order)) {
			return this.ensureValidDeliveryTargetObject(Game.getObjectById(creep.memory.order.target), resourceType);
		}

		return false;
	}

	/**
	 * Sets a good energy delivery target for this creep.
	 */
	calculateDeliveryTarget(): void {
		const creep = this.creep;
		const best = utilities.getBestOption(this.getAvailableDeliveryTargets());

		if (!best) {
			delete creep.memory.order;
			return;
		}

		if (isPositionOrderOption(best)) {
			creep.memory.order = {
				type: 'position',
				resourceType: best.resourceType,
				x: best.object.x,
				y: best.object.y,
			};
		}
		else if (isBayOrderOption(best)) {
			creep.memory.order = {
				type: 'bay',
				name: best.object.name,
				resourceType: best.resourceType,
			};
		}
		else if (isResourceDestinationOrder(creep.room, best)) {
			creep.memory.order = best;
		}
		else if (isDropOrderOption(best)) {
			// Just do it, no need to travel anywhere.
			creep.drop(best.resourceType);
			delete creep.memory.order;
		}
		else {
			creep.memory.order = {
				type: 'deliver',
				target: best.object.id,
				resourceType: best.resourceType,
			};
		}
	}

	/**
	 * Creates a priority list of possible delivery targets for this creep.
	 *
	 * @return {Array}
	 *   A list of potential delivery targets.
	 */
	getAvailableDeliveryTargets(): TransporterDestinationOrderOption[] {
		const creep = this.creep;
		const options: TransporterDestinationOrderOption[] = [];

		const task = creep.room.destinationDispatcher.getTask({creep});
		if (task && creep.store.getUsedCapacity(task.resourceType as ResourceConstant) > 0) options.push(task);

		const terminal = creep.room.terminal;

		if (creep.store[RESOURCE_ENERGY] > creep.store.getCapacity() * 0.1) {
			this.addSpawnBuildingDeliveryOptions(options);
			this.addContainerEnergyDeliveryOptions(options);
			this.addTowerDeliveryOptions(options);
			this.addHighLevelEnergyDeliveryOptions(options);
			this.addStorageEnergyDeliveryOptions(options);
			this.addLinkDeliveryOptions(options);
		}

		for (const resourceType of getResourcesIn(creep.store)) {
			// If it's needed for transferring, store in terminal.
			if (resourceType === creep.room.memory.fillTerminal && creep.store[resourceType] > 0 && !creep.room.isClearingTerminal()) {
				if (terminal && ((terminal.store[resourceType] || 0) < (creep.room.memory.fillTerminalAmount || 10_000)) && terminal.store.getFreeCapacity() > 0) {
					options.push({
						priority: 4,
						weight: creep.store[resourceType] / 100, // @todo Also factor in distance.
						type: 'structure',
						object: terminal,
						resourceType,
					});
				}
				else {
					creep.room.stopTradePreparation();
				}
			}

			// If it's needed for trading, store in terminal.
			if (terminal) {
				const roomSellOrders = _.filter(Game.market.orders, order => order.roomName === creep.room.name && order.type === ORDER_SELL);
				_.each(roomSellOrders, order => {
					if (order.resourceType !== resourceType) return;
					if ((terminal.store[order.resourceType] || 0) >= order.remainingAmount) return;
					if (creep.room.isClearingTerminal()) return;
					if (terminal.store.getFreeCapacity() < order.remainingAmount - (terminal.store[order.resourceType] || 0)) return;

					options.push({
						priority: 4,
						weight: creep.store[resourceType] / 100, // @todo Also factor in distance.
						type: 'structure',
						object: terminal,
						resourceType,
					});
				});
			}

			// The following only concerns resources other than energy.
			if (resourceType === RESOURCE_ENERGY || creep.store[resourceType] <= 0) continue;

			const storageTarget = creep.room.getBestStorageTarget(creep.store[resourceType], resourceType);

			// If there is space left, store in storage.
			if (storageTarget && storageTarget.store.getUsedCapacity() < storageTarget.store.getCapacity()) {
				options.push({
					priority: 1,
					weight: creep.store[resourceType] / 100, // @todo Also factor in distance.
					type: 'structure',
					object: storageTarget,
					resourceType,
				});
			}

			this.addHighLevelResourceDeliveryOptions(options, resourceType);
			this.addLabResourceDeliveryOptions(options, resourceType);

			// As a last resort, simply drop the resource since it can't be put anywhere.
			options.push({
				priority: 0,
				weight: 0,
				type: 'drop',
				resourceType,
			});
		}

		return options;
	}

	/**
	 * Adds spawns and single extensions as delivery targets.
	 *
	 * @param {Array} options
	 *   A list of potential delivery targets.
	 */
	addSpawnBuildingDeliveryOptions(options: TransporterDestinationOrderOption[]) {
		const creep = this.creep;

		// Primarily fill spawn and extenstions.
		const targets = creep.room.find<StructureExtension | StructureSpawn>(FIND_STRUCTURES, {
			filter: structure => {
				return (
					(structure.structureType === STRUCTURE_EXTENSION && !structure.isBayExtension()) ||
					(structure.structureType === STRUCTURE_SPAWN && (!structure.isBaySpawn() || creep.room.controller.level < 3))) &&
					structure.energy < structure.energyCapacity;
			},
		});

		for (const target of targets) {
			const canDeliver = Math.min(creep.store[RESOURCE_ENERGY], target.energyCapacity - target.energy);

			const option: TransporterStructureOrderOption = {
				priority: 5,
				weight: canDeliver / creep.store.getCapacity(),
				type: 'structure',
				object: target,
				resourceType: RESOURCE_ENERGY,
			};

			option.weight += 1 - (creep.pos.getRangeTo(target) / 100);
			option.priority -= creep.room.getCreepsWithOrder('deliver', target.id).length * 3;

			options.push(option);
		}

		// Fill bays.
		for (const bay of creep.room.bays) {
			const target = bay;

			if (target.energy >= target.energyCapacity) continue;
			if (target.hasHarvester()) continue;

			const canDeliver = Math.min(creep.store[RESOURCE_ENERGY], target.energyCapacity - target.energy);

			const option: TransporterBayOrderOption = {
				priority: 5,
				weight: canDeliver / creep.store.getCapacity(),
				type: 'bay',
				object: target,
				resourceType: RESOURCE_ENERGY,
			};

			option.weight += 1 - (creep.pos.getRangeTo(target) / 100);
			option.priority -= creep.room.getCreepsWithOrder('deliver', target.name).length * 3;

			options.push(option);
		}
	}

	/**
	 * Adds options for filling containers with energy.
	 *
	 * @param {Array} options
	 *   A list of potential delivery targets.
	 */
	addContainerEnergyDeliveryOptions(options: TransporterDestinationOrderOption[]) {
		const room: Room = this.creep.room;
		const targets = room.find<StructureContainer>(FIND_STRUCTURES, {
			filter: structure => {
				if (structure.structureType !== STRUCTURE_CONTAINER || structure.store.getFreeCapacity() === 0) return false;

				// Do deliver to controller containers when it is needed.
				// @todo Hand off energy to upgrader creeps in range.
				if (structure.id === structure.room.memory.controllerContainer) {
					if (room.creepsByRole.upgrader) return true;
					return false;
				}

				// Do not deliver to containers used as harvester drop off points.
				if (structure.room.sources) {
					for (const source of _.values<Source>(structure.room.sources)) {
						const container = source.getNearbyContainer();
						if (container && container.id === structure.id) {
							return false;
						}
					}

					if (structure.room.mineral) {
						const container = structure.room.mineral.getNearbyContainer();
						if (container && container.id === structure.id) {
							return false;
						}
					}
				}

				return true;
			},
		});

		for (const target of targets) {
			const option: TransporterStructureOrderOption = {
				priority: 4,
				weight: (target.store.getCapacity() - target.store[RESOURCE_ENERGY]) / 100, // @todo Also factor in distance, and other resources.
				type: 'structure',
				object: target,
				resourceType: RESOURCE_ENERGY,
			};

			let prioFactor = 1;
			if (target.store.getUsedCapacity() / target.store.getCapacity() > 0.75) {
				prioFactor = 3;
				option.priority--;
			}
			else if (target.store.getUsedCapacity() / target.store.getCapacity() > 0.5) {
				prioFactor = 2;
			}

			option.priority -= room.getCreepsWithOrder('deliver', target.id).length * prioFactor;

			options.push(option);
		}
	}

	/**
	 * Adds options for filling towers with energy.
	 *
	 * @param {Array} options
	 *   A list of potential delivery targets.
	 */
	addTowerDeliveryOptions(options: TransporterDestinationOrderOption[]) {
		const room = this.creep.room;
		const targets = room.find<StructureTower>(FIND_STRUCTURES, {
			filter: structure => (structure.structureType === STRUCTURE_TOWER) && structure.store[RESOURCE_ENERGY] < structure.store.getCapacity(RESOURCE_ENERGY) * 0.8,
		});

		for (const target of targets) {
			const option: TransporterStructureOrderOption = {
				priority: 3,
				weight: (target.store.getCapacity(RESOURCE_ENERGY) - target.store[RESOURCE_ENERGY]) / 100, // @todo Also factor in distance.
				type: 'structure',
				object: target,
				resourceType: RESOURCE_ENERGY,
			};

			if (room.memory.enemies && !room.memory.enemies.safe) {
				option.priority++;
			}

			if (target.store[RESOURCE_ENERGY] < target.store.getCapacity(RESOURCE_ENERGY) * 0.2) {
				option.priority++;
			}

			option.priority -= room.getCreepsWithOrder('deliver', target.id).length * 2;

			options.push(option);
		}
	}

	/**
	 * Adds options for filling nukers and power spawns with energy.
	 *
	 * @param {Array} options
	 *   A list of potential delivery targets.
	 */
	addHighLevelEnergyDeliveryOptions(options: TransporterDestinationOrderOption[]) {
		const room = this.creep.room;
		if (room.isEvacuating()) return;
		if (room.getCurrentResourceAmount(RESOURCE_ENERGY) < hivemind.settings.get('minEnergyForPowerProcessing')) return;

		const targets = room.find<StructureNuker | StructurePowerSpawn>(FIND_STRUCTURES, {
			filter: structure => (structure.structureType === STRUCTURE_NUKER || structure.structureType === STRUCTURE_POWER_SPAWN) && structure.energy < structure.energyCapacity,
		});

		for (const target of targets) {
			const option: TransporterStructureOrderOption = {
				priority: 1,
				weight: (target.energyCapacity - target.energy) / 100, // @todo Also factor in distance.
				type: 'structure',
				object: target,
				resourceType: RESOURCE_ENERGY,
			};

			if (target instanceof StructurePowerSpawn) {
				if (!balancer.maySpendEnergyOnPowerProcessing()) continue;
				if (target.store.getFreeCapacity(RESOURCE_ENERGY) < target.store.getCapacity(RESOURCE_ENERGY) * 0.2) continue;
				option.priority += 2;
			}

			option.priority -= room.getCreepsWithOrder('deliver', target.id).length * 2;

			options.push(option);
		}
	}

	/**
	 * Adds options for storing energy.
	 *
	 * @param {Array} options
	 *   A list of potential delivery targets.
	 */
	addStorageEnergyDeliveryOptions(options: TransporterDestinationOrderOption[]) {
		const creep = this.creep;
		// Put in storage if nowhere else needs it.
		const storageTarget = creep.room.getBestStorageTarget(creep.store[RESOURCE_ENERGY], RESOURCE_ENERGY);
		if (storageTarget) {
			options.push({
				priority: 0,
				weight: 0,
				type: 'structure',
				object: storageTarget,
				resourceType: RESOURCE_ENERGY,
			});
		}
		else {
			const storagePosition = creep.room.getStorageLocation();
			if (storagePosition) {
				options.push({
					priority: 0,
					weight: 0,
					type: 'position',
					object: creep.room.getPositionAt(storagePosition.x, storagePosition.y),
					resourceType: RESOURCE_ENERGY,
				});
			}
		}
	}

	/**
	 * Adds options for filling links with energy.
	 *
	 * @param {Array} options
	 *   A list of potential delivery targets.
	 */
	addLinkDeliveryOptions(options: TransporterDestinationOrderOption[]) {
		const creep = this.creep;
		// Deliver energy to storage links.
		if (!creep.room.linkNetwork || creep.room.linkNetwork.energy >= creep.room.linkNetwork.minEnergy) return;

		for (const link of creep.room.linkNetwork.neutralLinks) {
			if (link.store[RESOURCE_ENERGY] < link.store.getCapacity(RESOURCE_ENERGY)) {
				const option: TransporterStructureOrderOption = {
					priority: 5,
					weight: (link.store.getCapacity(RESOURCE_ENERGY) - link.store[RESOURCE_ENERGY]) / 100, // @todo Also factor in distance.
					type: 'structure',
					object: link,
					resourceType: RESOURCE_ENERGY,
				};

				if (creep.pos.getRangeTo(link) > 10) {
					// Don't go out of your way to fill the link, do it when nearby, e.g. at storage.
					option.priority--;
				}

				options.push(option);
			}
		}
	}

	/**
	 * Adds options for filling nukers and power spawns with resources.
	 *
	 * @param {Array} options
	 *   A list of potential delivery targets.
	 * @param {string} resourceType
	 *   The type of resource to deliver.
	 */
	addHighLevelResourceDeliveryOptions(options: TransporterDestinationOrderOption[], resourceType: ResourceConstant) {
		const creep = this.creep;
		// Put ghodium in nukers.
		if (resourceType === RESOURCE_GHODIUM && !creep.room.isEvacuating()) {
			const targets: StructureNuker[] = creep.room.find(FIND_MY_STRUCTURES, {
				filter: structure => (structure.structureType === STRUCTURE_NUKER) && structure.store.getFreeCapacity(RESOURCE_GHODIUM) > 0,
			});

			for (const target of targets) {
				options.push({
					priority: 2,
					weight: creep.store[resourceType] / 100, // @todo Also factor in distance.
					type: 'structure',
					object: target,
					resourceType,
				});
			}
		}

		// Put power in power spawns.
		if (resourceType === RESOURCE_POWER && creep.room.powerSpawn && !creep.room.isEvacuating()) {
			if (creep.room.powerSpawn.store[RESOURCE_POWER] < creep.room.powerSpawn.store.getCapacity(RESOURCE_POWER) * 0.1) {
				options.push({
					priority: 4,
					weight: creep.store[resourceType] / 100, // @todo Also factor in distance.
					type: 'structure',
					object: creep.room.powerSpawn,
					resourceType,
				});
			}
		}
	}

	/**
	 * Adds options for filling labs with resources.
	 *
	 * @param {Array} options
	 *   A list of potential delivery targets.
	 * @param {string} resourceType
	 *   The type of resource to deliver.
	 */
	addLabResourceDeliveryOptions(options: TransporterDestinationOrderOption[], resourceType: ResourceConstant) {
		const creep = this.creep;
		if (creep.room.memory.currentReaction && !creep.room.isEvacuating()) {
			if (resourceType === creep.room.memory.currentReaction[0]) {
				const lab = Game.getObjectById<StructureLab>(creep.room.memory.labs.source1);
				if (lab && (!lab.mineralType || lab.mineralType === resourceType) && lab.store[lab.mineralType] < lab.store.getCapacity(lab.mineralType) * 0.8) {
					options.push({
						priority: 4,
						weight: creep.store[resourceType] / 100, // @todo Also factor in distance.
						type: 'structure',
						object: lab,
						resourceType,
					});
				}
			}

			if (resourceType === creep.room.memory.currentReaction[1]) {
				const lab = Game.getObjectById<StructureLab>(creep.room.memory.labs.source2);
				if (lab && (!lab.mineralType || lab.mineralType === resourceType) && lab.store[lab.mineralType] < lab.store.getCapacity(lab.mineralType) * 0.8) {
					options.push({
						priority: 4,
						weight: creep.store[resourceType] / 100, // @todo Also factor in distance.
						type: 'structure',
						object: lab,
						resourceType,
					});
				}
			}
		}
	}

	/**
	 * Makes sure the creep has a valid target for resource delivery.
	 *
	 * @param {RoomObject} target
	 *   The target to deliver resources to.
	 * @param {string} resourceType
	 *   The type of resource that is being delivered.
	 *
	 * @return {boolean}
	 *   True if the target is valid and can receive the needed resource.
	 */
	ensureValidDeliveryTargetObject(target: AnyStoreStructure | Ruin | Tombstone, resourceType: ResourceConstant): boolean {
		if (!target) return false;
		if (this.creep.memory.singleRoom && target.pos.roomName !== this.creep.memory.singleRoom) return false;

		if (target.store && target.store.getFreeCapacity(resourceType) > 0) return true;

		return false;
	}

	/**
	 * Makes this creep collect resources.
	 *
	 * @param {Function} calculateSourceCallback
	 *   Optional callback to use when a new source target needs to be chosen.
	 */
	performGetResources(calculateSourceCallback?: () => void) {
		const creep = this.creep;
		if (!calculateSourceCallback) {
			calculateSourceCallback = () => {
				this.calculateSource();
			};
		}

		if (!this.ensureValidResourceSource(creep.memory.order, calculateSourceCallback)) {
			delete creep.memory.order;
			if (creep.memory.role === 'transporter') {
				if (creep.store.getUsedCapacity() > creep.store.getCapacity() * 0.1) {
					// Deliver what we already have stored, if no more can be found for picking up.
					this.setTransporterState(true);
				}
				else {
					this.setTransporterState(false);
				}
			}

			return;
		}

		if (isResourceSourceOrder(creep.room, creep.memory.order) && !isTargettedSourceOrder(creep.memory.order)) return;

		const target = Game.getObjectById(creep.memory.order.target);
		creep.whenInRange(1, target, () => {
			const resourceType = creep.memory.order.resourceType;
			let orderDone = false;
			if (target instanceof Resource) {
				orderDone = creep.pickup(target) === OK;
				if (
					orderDone &&
					creep.store.getFreeCapacity() > target.amount
				) {
					const containers = _.filter(target.pos.lookFor(LOOK_STRUCTURES), s => s.structureType === STRUCTURE_CONTAINER) as StructureContainer[];
					if (containers.length > 0 && (containers[0].store.getUsedCapacity(target.resourceType) || 0) > 0) {
						// We have picked up energy dropped on the ground probably due to a full
						// container. Pick up resources from the container next.
						creep.memory.order = {
							type: 'getResource',
							target: containers[0].id,
							resourceType: target.resourceType,
						};
						// Don't try to determine another source.
						return;
					}
				}
			}
			else {
				orderDone = creep.withdraw(target, resourceType) === OK;
			}

			if (orderDone) calculateSourceCallback();
		});
	}

	/**
	 * Makes sure the creep has a valid target for resource pickup.
	 *
	 * @param {Function } calculateSourceCallback
	 *   Callback to use when a new source target needs to be chosen.
	 *
	 * @return {boolean}
	 *   True if the target is valid and contains the needed resource.
	 */
	ensureValidResourceSource(order: TransporterOrder, calculateSourceCallback: () => void): order is TransporterGetEnergyOrder | ResourceSourceTask {
		const creep = this.creep;

		if (!order) {
			calculateSourceCallback();
			order = creep.memory.order;
		}
		if (!order) return false;

		if (isResourceSourceOrder(creep.room, order)) {
			return creep.room.sourceDispatcher.validateTask(order);
		}

		// The only valid source order type is `getEnergy` / `getResource`.
		if (!isCollectOrder(order)) return false;

		const target = Game.getObjectById(order.target);
		if (!target) return false;
		if (creep.memory.singleRoom && target.pos.roomName !== creep.memory.singleRoom) return false;

		const resourceType = order.resourceType;
		if ('store' in target && ((target as AnyStoreStructure).store.getUsedCapacity(resourceType)) > 0) return true;
		if (target instanceof Resource && target.amount > 0) return true;

		return false;
	}

	/**
	 * Sets a good resource source target for this creep.
	 */
	calculateSource() {
		const creep = this.creep;
		const best = utilities.getBestOption(this.getAvailableSources());

		if (!best) {
			delete creep.memory.order;
			return;
		}

		if (isResourceSourceOrder(creep.room, best)) {
			creep.memory.order = best;
			return;
		}

		creep.memory.order = {
			type: 'getResource',
			target: best.object.id,
			resourceType: best.resourceType,
		};
	}

	/**
	 * Creates a priority list of resources available to this creep.
	 *
	 * @return {Array}
	 *   A list of potential resource sources.
	 */
	getAvailableSources(): TransporterSourceOrderOption[] {
		const creep = this.creep;
		const options = this.getAvailableEnergySources();

		const task = creep.room.sourceDispatcher.getTask({creep});
		if (task) options.push(task);

		const terminal = creep.room.terminal;
		const storage = creep.room.storage;

		// Don't pick up anything that's not energy if there's no place to store.
		if (!terminal && !storage) return options;

		// Clear out overfull terminal.
		const storageHasSpace = storage && storage.store.getFreeCapacity() >= creep.store.getCapacity();
		const terminalNeedsClearing = terminal && (terminal.store.getUsedCapacity() > terminal.store.getCapacity() * 0.8 || creep.room.isClearingTerminal()) && !creep.room.isClearingStorage();
		if (terminalNeedsClearing && storageHasSpace) {
			// Find resource with highest count and take that.
			// @todo Unless it's supposed to be sent somewhere else.
			let max = null;
			let maxResourceType = null;
			for (const resourceType in terminal.store) {
				// Do not take out energy if there is enough in storage.
				if (resourceType === RESOURCE_ENERGY && storage && storage.store[RESOURCE_ENERGY] > terminal.store[RESOURCE_ENERGY] * 5) continue;
				if (resourceType === creep.room.memory.fillTerminal) continue;

				if (!max || terminal.store[resourceType] > max) {
					max = terminal.store[resourceType];
					maxResourceType = resourceType;
				}
			}

			const option: TransporterStructureOrderOption = {
				priority: 1,
				weight: 0,
				type: 'structure',
				object: terminal,
				resourceType: maxResourceType,
			};

			if (creep.room.isClearingTerminal()) {
				option.priority = 2;
			}

			options.push(option);
		}

		this.addTerminalOperationResourceOptions(options);
		this.addObjectResourceOptions(options, FIND_DROPPED_RESOURCES, 'resource');
		this.addObjectResourceOptions(options, FIND_TOMBSTONES, 'tombstone');
		this.addObjectResourceOptions(options, FIND_RUINS, 'tombstone');
		this.addContainerResourceOptions(options);
		this.addHighLevelResourceOptions(options);
		this.addEvacuatingRoomResourceOptions(options);
		this.addLabResourceOptions(options);

		return options;
	}

	/**
	 * Creates a priority list of energy sources available to this creep.
	 *
	 * @return {Array}
	 *   A list of potential energy sources.
	 */
	getAvailableEnergySources(): TransporterSourceOrderOption[] {
		const room = this.creep.room;
		const options: TransporterSourceOrderOption[] = [];

		const task = this.creep.room.sourceDispatcher.getTask({
			creep: this.creep,
			resourceType: RESOURCE_ENERGY,
		});
		if (task) options.push(task);

		let priority = 0;
		if (room.energyAvailable < room.energyCapacityAvailable * 0.9) {
			// Spawning is important, so get energy when needed.
			priority = 4;
		}
		else if (room.terminal && room.storage && room.terminal.store.energy < room.storage.store.energy * 0.05) {
			// Take some energy out of storage to put into terminal from time to time.
			priority = 2;
		}

		this.addObjectEnergySourceOptions(options, FIND_DROPPED_RESOURCES, 'resource', priority);
		this.addObjectEnergySourceOptions(options, FIND_TOMBSTONES, 'tombstone', priority);
		this.addObjectEnergySourceOptions(options, FIND_RUINS, 'tombstone', priority);
		this.addContainerEnergySourceOptions(options);
		this.addLinkEnergySourceOptions(options);

		return options;
	}

	/**
	 * Adds options for picking up energy from room objects to priority list.
	 *
	 * @param {Array} options
	 *   A list of potential energy sources.
	 * @param {String} findConstant
	 *   The type of find operation to run, e.g. FIND_DROPPED_RESOURCES.
	 * @param {string} optionType
	 *   Type designation of added resource options.
	 */
	addObjectEnergySourceOptions(options: TransporterSourceOrderOption[], findConstant: FIND_RUINS | FIND_TOMBSTONES | FIND_DROPPED_RESOURCES, optionType: 'resource' | 'tombstone', storagePriority: number) {
		const creep = this.creep;

		// Get storage location, since that is a low priority source for transporters.
		const storagePosition = creep.room.getStorageLocation();

		// Look for energy on the ground.
		const targets = creep.room.find(findConstant, {
			filter: target => {
				const store = target instanceof Resource ? {[target.resourceType]: target.amount} : target.store;
				if ((store[RESOURCE_ENERGY] || 0) < 20) return false;

				// const result = PathFinder.search(creep.pos, target.pos);
				// if (result.incomplete) return false;

				return true;
			},
		});

		for (const target of targets) {
			const store = target instanceof Resource ? {[target.resourceType]: target.amount} : target.store;
			const option = {
				priority: 4,
				weight: store[RESOURCE_ENERGY] / 100, // @todo Also factor in distance.
				type: optionType,
				object: target,
				resourceType: RESOURCE_ENERGY,
			};

			if (storagePosition && target.pos.x === storagePosition.x && target.pos.y === storagePosition.y) {
				option.priority = creep.memory.role === 'transporter' ? storagePriority : 5;
			}
			else {
				if (store[RESOURCE_ENERGY] < 100) option.priority--;
				if (store[RESOURCE_ENERGY] < 200) option.priority--;

				// If spawn / extensions need filling, transporters should not pick up
				// energy from random targets as readily, instead prioritize storage.
				if (creep.room.energyAvailable < creep.room.energyCapacityAvailable && creep.memory.role === 'transporter') option.priority -= 2;
			}

			option.priority -= creep.room.getCreepsWithOrder('getEnergy', target.id).length * 3;
			option.priority -= creep.room.getCreepsWithOrder('getResource', target.id).length * 3;

			if (creep.room.getFreeStorage() < store[RESOURCE_ENERGY]) {
				// If storage is super full, try leaving stuff on the ground.
				option.priority -= 2;
			}

			options.push(option);
		}
	}

	/**
	 * Adds options for picking up energy from containers to priority list.
	 *
	 * @param {Array} options
	 *   A list of potential energy sources.
	 */
	addContainerEnergySourceOptions(options: TransporterSourceOrderOption[]) {
		const creep = this.creep;

		// Look for energy in Containers.
		const targets = creep.room.find<StructureContainer>(FIND_STRUCTURES, {
			filter: structure => (structure.structureType === STRUCTURE_CONTAINER) && structure.store[RESOURCE_ENERGY] > creep.store.getCapacity() * 0.1,
		});

		// Prefer containers used as harvester dropoff.
		for (const target of targets) {
			// Don't use the controller container as a normal source if we're upgrading.
			if (target.id === target.room.memory.controllerContainer && creep.room.creepsByRole.upgrader) continue;

			const option: TransporterStructureOrderOption = {
				priority: 1,
				weight: target.store[RESOURCE_ENERGY] / 100, // @todo Also factor in distance.
				type: 'structure',
				object: target,
				resourceType: RESOURCE_ENERGY,
			};

			for (const source of target.room.sources) {
				if (source.getNearbyContainer()?.id !== target.id) continue;

				option.priority++;
				if (target.store.getUsedCapacity() >= creep.store.getFreeCapacity()) {
					// This container is filling up, prioritize emptying it when we aren't
					// busy filling extensions.
					if (creep.room.energyAvailable >= creep.room.energyCapacityAvailable || creep.memory.role !== 'transporter') option.priority += 2;
				}

				break;
			}

			for (const bay of target.room.bays) {
				if (bay.pos.getRangeTo(target.pos) > 0) continue;
				if (!target.room.roomPlanner) continue;
				if (!target.room.roomPlanner.isPlannedLocation(target.pos, 'harvester')) continue;

				if (target.store.getUsedCapacity() < target.store.getCapacity() / 3) {
					// Do not empty containers in harvester bays for quicker extension refills.
					option.priority = -1;
				}

				break;
			}

			option.priority -= creep.room.getCreepsWithOrder('getEnergy', target.id).length * 3;
			option.priority -= creep.room.getCreepsWithOrder('getResource', target.id).length * 3;

			options.push(option);
		}
	}

	/**
	 * Adds options for picking up energy from links to priority list.
	 *
	 * @param {Array} options
	 *   A list of potential energy sources.
	 */
	addLinkEnergySourceOptions(options: TransporterSourceOrderOption[]) {
		const creep = this.creep;

		if (!creep.room.linkNetwork) return;
		if (creep.room.linkNetwork.energy <= creep.room.linkNetwork.maxEnergy) return;

		for (const link of creep.room.linkNetwork.neutralLinks) {
			if (link.store[RESOURCE_ENERGY] === 0) continue;

			const option = {
				priority: 5,
				weight: link.store[RESOURCE_ENERGY] / 100, // @todo Also factor in distance.
				type: 'structure',
				object: link,
				resourceType: RESOURCE_ENERGY,
			};

			if (creep.pos.getRangeTo(link) > 10) {
				// Don't go out of your way to empty the link, do it when nearby, e.g. at storage.
				option.priority--;
			}

			option.priority -= creep.room.getCreepsWithOrder('getEnergy', link.id).length * 2;
			option.priority -= creep.room.getCreepsWithOrder('getResource', link.id).length * 2;

			options.push(option);
		}
	}

	/**
	 * Take resources that need to be put in terminal for trading.
	 *
	 * @param {Array} options
	 *   A list of potential resource sources.
	 */
	addTerminalOperationResourceOptions(options: TransporterSourceOrderOption[]) {
		const creep = this.creep;
		const storage = creep.room.storage;
		const terminal = creep.room.terminal;
		if (creep.room.isClearingTerminal()) return;
		if (!storage || !terminal) return;

		// Take resources from storage to terminal for transfer if requested.
		if (creep.room.memory.fillTerminal) {
			const resourceType = creep.room.memory.fillTerminal;
			if (storage.store[resourceType]) {
				if (terminal.store.getFreeCapacity() > 10_000) {
					options.push({
						priority: 4,
						weight: 0,
						type: 'structure',
						object: storage,
						resourceType,
					});
				}
			}
			else {
				// No more of these resources can be taken into terminal.
				delete creep.room.memory.fillTerminal;
			}
		}

		const roomSellOrders = _.filter(Game.market.orders, order => order.roomName === creep.room.name && order.type === ORDER_SELL);
		_.each(roomSellOrders, order => {
			if ((terminal.store[order.resourceType] || 0) >= order.remainingAmount) return;
			if (!storage.store[order.resourceType]) return;
			if (terminal.store.getFreeCapacity() < order.remainingAmount - (terminal.store[order.resourceType] || 0)) return;

			options.push({
				priority: 4,
				weight: 0,
				type: 'structure',
				object: storage,
				resourceType: order.resourceType as ResourceConstant,
			});
		});
	}

	/**
	 * Adds options for picking up resources from certain objects to priority list.
	 *
	 * @param {Array} options
	 *   A list of potential resource sources.
	 * @param {String} findConstant
	 *   The type of find operation to run, e.g. FIND_DROPPED_RESOURCES.
	 * @param {string} optionType
	 *   Type designation of added resource options.
	 */
	addObjectResourceOptions(options: TransporterSourceOrderOption[], findConstant: FIND_RUINS | FIND_TOMBSTONES | FIND_DROPPED_RESOURCES, optionType: 'resource' | 'tombstone') {
		const creep = this.creep;

		// Look for resources on the ground.
		const targets = creep.room.find(findConstant, {
			filter: target => {
				const storeAmount = target instanceof Resource ? target.amount : target.store.getUsedCapacity();
				if (storeAmount > 10) {
					const result = PathFinder.search(creep.pos, target.pos);
					if (!result.incomplete) return true;
				}

				return false;
			},
		});

		for (const target of targets) {
			const store = target instanceof Resource ? {[target.resourceType]: target.amount} : target.store;
			for (const resourceType of getResourcesIn(store)) {
				if (resourceType === RESOURCE_ENERGY) continue;
				if (store[resourceType] === 0) continue;

				const option = {
					priority: 4,
					weight: store[resourceType] / 30, // @todo Also factor in distance.
					type: optionType,
					object: target,
					resourceType,
				};

				if (resourceType === RESOURCE_POWER) {
					option.priority++;
				}

				if (creep.room.getFreeStorage() < store[resourceType]) {
					// If storage is super full, try leaving stuff on the ground.
					option.priority -= 2;
				}

				option.priority -= creep.room.getCreepsWithOrder('getEnergy', target.id).length * 2;
				option.priority -= creep.room.getCreepsWithOrder('getResource', target.id).length * 2;

				options.push(option);
			}
		}
	}

	/**
	 * Adds options for picking up resources from containers to priority list.
	 *
	 * @param {Array} options
	 *   A list of potential resource sources.
	 */
	addContainerResourceOptions(options: TransporterSourceOrderOption[]) {
		const room = this.creep.room;
		// We need a decent place to store these resources.
		if (!room.terminal && !room.storage) return;

		// Take non-energy out of containers.
		const containers = room.find<StructureContainer>(FIND_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_CONTAINER,
		});

		for (const container of containers) {
			for (const resourceType of getResourcesIn(container.store)) {
				if (resourceType === RESOURCE_ENERGY) continue;
				if (container.store[resourceType] === 0) continue;
				if (container.id === room.mineral.getNearbyContainer()?.id && resourceType === room.mineral.mineralType && container.store[resourceType] < CONTAINER_CAPACITY / 2) continue;

				const option: TransporterStructureOrderOption = {
					priority: 3,
					weight: container.store[resourceType] / 20, // @todo Also factor in distance.
					type: 'structure',
					object: container,
					resourceType,
				};

				option.priority -= room.getCreepsWithOrder('getResource', container.id).length * 2;

				options.push(option);
			}
		}
	}

	/**
	 * Adds options for picking up resources for nukers and power spawns.
	 *
	 * @param {Array} options
	 *   A list of potential resource sources.
	 */
	addHighLevelResourceOptions(options: TransporterSourceOrderOption[]) {
		const room = this.creep.room;

		// Take ghodium if nuker needs it.
		if (room.nuker && room.nuker.store.getFreeCapacity(RESOURCE_GHODIUM) > 0) {
			const target = room.getBestStorageSource(RESOURCE_GHODIUM);
			if (target && target.store[RESOURCE_GHODIUM] > 0) {
				const option = {
					priority: 2,
					weight: 0, // @todo Also factor in distance.
					type: 'structure',
					object: target,
					resourceType: RESOURCE_GHODIUM,
				};

				options.push(option);
			}
		}

		// Take power if power spawn needs it.
		if (room.powerSpawn && room.powerSpawn.store[RESOURCE_POWER] < room.powerSpawn.store.getCapacity(RESOURCE_POWER) * 0.1) {
			const target = room.getBestStorageSource(RESOURCE_POWER);
			if (target && target.store[RESOURCE_POWER] > 0) {
				// @todo Limit amount since power spawn can only hold 100 power at a time.
				// @todo Make sure only 1 creep does this at a time.
				const option = {
					priority: 3,
					weight: 0, // @todo Also factor in distance.
					type: 'structure',
					object: target,
					resourceType: RESOURCE_POWER,
				};

				if (room.isFullOnPower()) {
					option.priority++;
				}

				options.push(option);
			}
		}
	}

	/**
	 * Adds options for picking up resources for moving to terminal.
	 *
	 * @param {Array} options
	 *   A list of potential resource sources.
	 */
	addEvacuatingRoomResourceOptions(options: TransporterSourceOrderOption[]) {
		const room = this.creep.room;
		if (!room.isEvacuating()) return;

		// Take everything out of labs.
		const labs = room.find<StructureLab>(FIND_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_LAB,
		});

		for (const lab of labs) {
			if (lab.store[RESOURCE_ENERGY] > 0) {
				options.push({
					priority: 4,
					weight: 0,
					type: 'structure',
					object: lab,
					resourceType: RESOURCE_ENERGY,
				});
			}

			if (lab.mineralType) {
				options.push({
					priority: 4,
					weight: 0,
					type: 'structure',
					object: lab,
					resourceType: lab.mineralType,
				});
			}
		}

		// @todo Destroy nuker once storage is empty so we can pick up contained resources.
	}

	/**
	 * Adds options for picking up resources for lab management.
	 *
	 * @param {Array} options
	 *   A list of potential resource sources.
	 */
	addLabResourceOptions(options: TransporterSourceOrderOption[]) {
		const room = this.creep.room;
		const currentReaction = room.memory.currentReaction;
		if (!room.memory.canPerformReactions) return;
		if (room.isEvacuating()) return;

		const labs = room.memory.labs.reactor;
		for (const labID of labs) {
			// Clear out reaction labs.
			const lab = Game.getObjectById<StructureLab>(labID);

			const mineralAmount = lab.store[lab.mineralType];
			const mineralCapacity = lab.store.getCapacity(lab.mineralType);
			if (lab && mineralAmount > 0) {
				const option = {
					priority: 0,
					weight: mineralAmount / mineralCapacity,
					type: 'structure',
					object: lab,
					resourceType: lab.mineralType,
				};

				if (mineralAmount > mineralCapacity * 0.8) {
					option.priority++;
				}

				if (mineralAmount > mineralCapacity * 0.9) {
					option.priority++;
				}

				if (mineralAmount > mineralCapacity * 0.95) {
					option.priority++;
				}

				if (currentReaction) {
					// If we're doing a different reaction now, clean out faster!
					if (REACTIONS[currentReaction[0]][currentReaction[1]] !== lab.mineralType) {
						option.priority = 3;
						option.weight = 0;
					}
				}

				if (option.priority > 0) options.push(option);
			}
		}

		if (!currentReaction) return;

		// Clear out labs with wrong resources.
		let lab = Game.getObjectById<StructureLab>(room.memory.labs.source1);
		if (lab && lab.store[lab.mineralType] > 0 && lab.mineralType !== currentReaction[0]) {
			const option = {
				priority: 3,
				weight: 0,
				type: 'structure',
				object: lab,
				resourceType: lab.mineralType,
			};

			options.push(option);
		}

		lab = Game.getObjectById<StructureLab>(room.memory.labs.source2);
		if (lab && lab.store[lab.mineralType] > 0 && lab.mineralType !== currentReaction[1]) {
			const option = {
				priority: 3,
				weight: 0,
				type: 'structure',
				object: lab,
				resourceType: lab.mineralType,
			};

			options.push(option);
		}

		// Get reaction resources.
		this.addSourceLabResourceOptions(options, Game.getObjectById<StructureLab>(room.memory.labs.source1), currentReaction[0]);
		this.addSourceLabResourceOptions(options, Game.getObjectById<StructureLab>(room.memory.labs.source2), currentReaction[1]);
	}

	/**
	 * Adds options for getting reaction lab resources.
	 *
	 * @param {Array} options
	 *   A list of potential resource sources.
	 * @param {StructureLab} lab
	 *   The lab to fill.
	 * @param {string} resourceType
	 *   The type of resource that should be put in the lab.
	 */
	addSourceLabResourceOptions(options: TransporterSourceOrderOption[], lab: StructureLab, resourceType: ResourceConstant) {
		if (!lab) return;
		if (lab.mineralType && lab.mineralType !== resourceType) return;
		if (lab.store[lab.mineralType] > lab.store.getCapacity(lab.mineralType) * 0.5) return;

		const source = this.creep.room.getBestStorageSource(resourceType);
		if (!source) return;
		if ((source.store[resourceType] || 0) === 0) return;

		const option = {
			priority: 3,
			weight: 1 - (lab.store[lab.mineralType] / lab.store.getCapacity(lab.mineralType)),
			type: 'structure',
			object: source,
			resourceType,
		};

		if (lab.store[lab.mineralType] > lab.store.getCapacity(lab.mineralType) * 0.2) {
			option.priority--;
		}

		options.push(option);
	}

	/**
	 * Makes this creep collect energy.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performGetEnergy(creep: TransporterCreep) {
		this.creep = creep;
		this.performGetResources(() => {
			this.calculateEnergySource();
		});
	}

	/**
	 * Sets a good energy source target for this creep.
	 */
	calculateEnergySource() {
		const creep = this.creep;
		const best = utilities.getBestOption(this.getAvailableEnergySources());

		if (!best) {
			delete creep.memory.order;
			return;
		}

		if (isResourceSourceOrder(creep.room, best)) {
			creep.memory.order = best;
			return;
		}

		creep.memory.order = {
			type: 'getEnergy',
			target: best.object.id,
			resourceType: best.resourceType,
		};
	}
}
