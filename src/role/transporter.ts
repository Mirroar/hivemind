/* global PathFinder Room RoomPosition FIND_DROPPED_RESOURCES
STRUCTURE_CONTAINER RESOURCE_POWER RESOURCE_GHODIUM STRUCTURE_LAB REACTIONS
STRUCTURE_EXTENSION STRUCTURE_SPAWN STRUCTURE_TOWER STRUCTURE_NUKER ERR_NO_PATH
STRUCTURE_POWER_SPAWN TERRAIN_MASK_WALL LOOK_STRUCTURES RESOURCE_ENERGY
LOOK_CONSTRUCTION_SITES OK ORDER_SELL FIND_TOMBSTONES FIND_RUINS */

import balancer from 'excess-energy-balancer';
import hivemind from 'hivemind';
import Role from 'role/role';
import utilities from 'utilities';
import {getResourcesIn} from 'utils/store';
import {handleMapArea} from 'utils/map';

type TransporterDropOrderOption = {
	priority: number;
	weight: number;
	type: 'drop';
	resourceType: ResourceConstant;
};

type TransporterStructureOrderOption = {
	priority: number;
	weight: number;
	type: 'structure';
	object: AnyStoreStructure;
	resourceType: ResourceConstant;
};

type TransporterTombstoneOrderOption = {
	priority: number;
	weight: number;
	type: 'tombstone';
	object: Ruin | Tombstone;
	resourceType: ResourceConstant;
};

type TransporterPickupOrderOption = {
	priority: number;
	weight: number;
	type: 'resource';
	object: Resource;
	resourceType: ResourceConstant;
};

type TransporterPositionOrderOption = {
	priority: number;
	weight: number;
	type: 'position';
	object: RoomPosition;
	resourceType: ResourceConstant;
};

type TransporterSourceOrderOption = ResourceSourceTask | TransporterStructureOrderOption | TransporterPickupOrderOption | TransporterTombstoneOrderOption;

type TransporterGetEnergyOrder = {
	type: 'getEnergy' | 'getResource';
	target: Id<AnyStoreStructure | Resource | Ruin | Tombstone>;
	resourceType: ResourceConstant;
};

type TransporterOrder = TransporterGetEnergyOrder | ResourceSourceTask | ResourceDestinationTask;

declare global {
	interface TransporterCreep extends Creep {
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
		energyTakenFrom?: Id<AnyStoreStructure>;
		idlingFor?: number;
	}
}

function isResourceDestinationOrder(room: Room, order: TransporterOrder): order is ResourceDestinationTask {
	if ('type' in order && room.destinationDispatcher.hasProvider(order.type)) {
		return true;
	}

	return false;
}

function isStructureDestinationOrder(order: ResourceDestinationTask): order is StructureDestinationTask {
	return 'target' in order;
}

function isBayDestinationOrder(order: ResourceDestinationTask): order is BayDestinationTask {
	return order.type === 'bay';
}

function isResourceSourceOrder(room: Room, order: TransporterOrder): order is ResourceSourceTask {
	if ('type' in order && room.sourceDispatcher.hasProvider(order.type)) {
		return true;
	}

	return false;
}

function isStructureSourceOrder(order: ResourceSourceTask): order is StructureSourceTask {
	return 'target' in order;
}

function isCollectOrder(order: TransporterOrder): order is TransporterGetEnergyOrder {
	return order.type == 'getEnergy' || order.type == 'getResource';
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

		if (creep.memory.singleRoom && creep.memory.order && 'target' in creep.memory.order) {
			const target = Game.getObjectById<RoomObject & _HasId>(creep.memory.order.target);
			if (target && target.pos && target.pos.roomName !== creep.memory.singleRoom) {
				this.setTransporterState(creep.memory.delivering);
			}
		}

		if ((creep.heapMemory.idlingFor || 0) > 0) {
			creep.heapMemory.idlingFor--;
			creep.whenInRange(1, creep, () => {});
			return;
		}

		if (creep.store.getUsedCapacity() >= creep.store.getCapacity() * 0.9 && !creep.memory.delivering) {
			this.setTransporterState(true);
		}
		else if (creep.store.getUsedCapacity() <= creep.store.getCapacity() * 0.1 && creep.memory.delivering // Don't switch state if we're currently filling a bay.
			&& (!creep.memory.order || !isResourceDestinationOrder(creep.room, creep.memory.order) || !isBayDestinationOrder(creep.memory.order))) {
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
			if (creep.memory.order && isResourceDestinationOrder(creep.room, creep.memory.order) && isBayDestinationOrder(creep.memory.order) && creep.memory.order.name === bay.name) continue;

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
				if (_.some(structures, structure => !structure.isWalkable())) return;

				// Check if there's a construction site here already.
				const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
				if (_.some(sites, site => !site.isWalkable())) return;

				availableTiles.push(pos);
			});

			if (availableTiles.length === 1) {
				// Move out of the way.
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
			creep.whenInRange(1, creep, () => {});
			delete creep.memory.order;
			return;
		}

		const order = creep.memory.order;
		if (isResourceDestinationOrder(creep.room, order)) {
			creep.room.destinationDispatcher.executeTask(order, {creep});
			return;
		}

		// Unknown target type, reset!
		hivemind.log('default').error('Unknown target type for delivery found!', JSON.stringify(order.type));
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

		if (isResourceDestinationOrder(creep.room, creep.memory.order)) {
			if (
				creep.memory.order.resourceType === RESOURCE_ENERGY
				&& creep.heapMemory.energyTakenFrom
				&& isStructureDestinationOrder(creep.memory.order)
				&& creep.heapMemory.energyTakenFrom === creep.memory.order.target
			) {
				// We're looping, taking energy and putting it right back.
				// Instead, we should wait for a while until new tasks show up.
				delete creep.memory.order;
				delete creep.heapMemory.energyTakenFrom;
				creep.heapMemory.idlingFor = 20;
				return false;
			}

			return creep.room.destinationDispatcher.validateTask(creep.memory.order, {creep});
		}

		return false;
	}

	/**
	 * Sets a good energy delivery target for this creep.
	 */
	calculateDeliveryTarget(): void {
		const creep = this.creep;
		creep.memory.order = creep.room.destinationDispatcher.getTask({creep});

		if (!creep.memory.order) {
			if (creep.store.getFreeCapacity() > 0) this.setTransporterState(false);
			return;
		}

		creep.room.visual.text('target: ' + creep.memory.order.type + '@' + creep.memory.order.priority, creep.pos);
	}

	/**
	 * Makes this creep collect resources.
	 *
	 * @param {Function} calculateSourceCallback
	 *   Optional callback to use when a new source target needs to be chosen.
	 */
	performGetResources(sourceCallback?: () => void) {
		const creep = this.creep;
		if (!sourceCallback) {
			sourceCallback = () => {
				this.calculateSource();
			};
		}

		const calculateSourceCallback = () => {
			delete creep.heapMemory.energyTakenFrom;
			sourceCallback();

			const newOrder = creep.memory.order;
			if (newOrder && isResourceSourceOrder(creep.room, newOrder) && isStructureSourceOrder(newOrder) && newOrder.resourceType === RESOURCE_ENERGY) {
				creep.heapMemory.energyTakenFrom = newOrder.target;
			}
		};

		if (!this.ensureValidResourceSource(creep.memory.order, calculateSourceCallback)) {
			delete creep.memory.order;
			creep.whenInRange(1, creep, () => {});

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

		if (isResourceSourceOrder(creep.room, creep.memory.order)) {
			creep.room.sourceDispatcher.executeTask(creep.memory.order, {creep});
			return;
		}

		const target = Game.getObjectById(creep.memory.order.target);
		creep.whenInRange(1, target, () => {
			const resourceType = creep.memory.order.resourceType;
			let orderDone = false;
			if (target instanceof Resource) {
				orderDone = creep.pickup(target) === OK;
				if (
					orderDone
					&& creep.store.getFreeCapacity() > target.amount
				) {
					const containers = _.filter(target.pos.lookFor(LOOK_STRUCTURES), s => s.structureType === STRUCTURE_CONTAINER) as StructureContainer[];
					if (containers.length > 0 && (containers[0].store.getUsedCapacity(target.resourceType) || 0) > 0) {
						// We have picked up resources dropped on the ground probably due to a full
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
			else if ('amount' in creep.memory.order) {
				orderDone = creep.withdraw(target, resourceType, Math.min(target.store.getUsedCapacity(resourceType), creep.memory.order.amount, creep.store.getFreeCapacity())) === OK;
			}
			else {
				orderDone = creep.withdraw(target, resourceType) === OK;
			}

			if (orderDone) {
				delete creep.memory.order;
				// @todo We may calculate a new order based on the projected contents of this creep's score.
				// calculateSourceCallback();
			}
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
			return creep.room.sourceDispatcher.validateTask(order, {creep});
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

		creep.room.visual.text('source: ' + best.type + '@' + best.priority, creep.pos);

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

		const terminal = creep.room.terminal;
		const storage = creep.room.storage;

		// Don't pick up anything that's not energy if there's no place to store.
		if (!terminal && !storage) return options;

		const dispatcherTask = creep.room.sourceDispatcher.getTask({
			creep,
			resourceType: null,
		});
		if (dispatcherTask) options.push(dispatcherTask);

		this.addObjectResourceOptions(options, FIND_DROPPED_RESOURCES, 'resource');
		this.addObjectResourceOptions(options, FIND_TOMBSTONES, 'tombstone');
		this.addObjectResourceOptions(options, FIND_RUINS, 'tombstone');
		this.addContainerResourceOptions(options);
		this.addHighLevelResourceOptions(options);
		this.addEvacuatingRoomResourceOptions(options);

		return options;
	}

	/**
	 * Creates a priority list of energy sources available to this creep.
	 *
	 * @return {Array}
	 *   A list of potential energy sources.
	 */
	getAvailableEnergySources(): TransporterSourceOrderOption[] {
		const creep = this.creep;
		const room = creep.room;
		const options: TransporterSourceOrderOption[] = [];

		const task = creep.room.sourceDispatcher.getTask({
			creep,
			resourceType: RESOURCE_ENERGY,
		});
		if (task) options.push(task);

		let priority = 0;
		if (room.energyAvailable < room.energyCapacityAvailable * 0.9) {
			// Spawning is important, so get energy when needed.
			priority = 4;
		}
		else if (room.terminal && room.storage && room.storage.store.energy > 5000 && room.terminal.store.energy < room.storage.store.energy * 0.05 && !room.isClearingTerminal()) {
			// Take some energy out of storage to put into terminal from time to time.
			priority = 2;
		}

		this.addObjectEnergySourceOptions(options, FIND_DROPPED_RESOURCES, 'resource', priority);
		this.addObjectEnergySourceOptions(options, FIND_TOMBSTONES, 'tombstone', priority);
		this.addObjectEnergySourceOptions(options, FIND_RUINS, 'tombstone', priority);

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
				if (!this.isSafePosition(creep, target.pos)) return false;

				// Const result = PathFinder.search(creep.pos, target.pos);
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
				if (creep.room.energyAvailable < creep.room.energyCapacityAvailable && creep.room.getCurrentResourceAmount(RESOURCE_ENERGY) > 5000 && creep.memory.role === 'transporter') option.priority -= 2;
			}

			if (store[RESOURCE_ENERGY] < creep.store.getCapacity() * 2) {
				option.priority -= creep.room.getCreepsWithOrder('getEnergy', target.id).length * 3;
				option.priority -= creep.room.getCreepsWithOrder('getResource', target.id).length * 3;
			}

			if (creep.room.storage && creep.room.getFreeStorage() < store[RESOURCE_ENERGY] && creep.room.getEffectiveAvailableEnergy() > 20_000) {
				// If storage is super full, try leaving stuff on the ground.
				option.priority -= 2;
			}

			options.push(option);
		}
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
				if (!this.isSafePosition(creep, target.pos)) return false;

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
					continue;
				}

				if (store[resourceType] < creep.store.getCapacity() * 2) {
					option.priority -= creep.room.getCreepsWithOrder('getEnergy', target.id).length * 2;
					option.priority -= creep.room.getCreepsWithOrder('getResource', target.id).length * 2;
				}

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
		const containers = _.filter(
			room.structuresByType[STRUCTURE_CONTAINER],
			structure => this.isSafePosition(this.creep, structure.pos),
		);

		for (const container of containers) {
			for (const resourceType of getResourcesIn(container.store)) {
				if (resourceType === RESOURCE_ENERGY) continue;
				if (container.store[resourceType] === 0) continue;

				let isEmptyMineralContainer = false;
				for (const mineral of room.minerals) {
					if (
						container.id === mineral.getNearbyContainer()?.id
						&& resourceType === mineral.mineralType
						&& container.store[resourceType] < CONTAINER_CAPACITY / 2
					) {
						isEmptyMineralContainer = true;
						break;
					}
				}

				if (isEmptyMineralContainer) continue;

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
		if (room.isEvacuating()) return;

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
		if (room.powerSpawn && room.powerSpawn.store[RESOURCE_POWER] < room.powerSpawn.store.getCapacity(RESOURCE_POWER) * 0.1 && balancer.maySpendEnergyOnPowerProcessing()) {
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
		const labs = room.myStructuresByType[STRUCTURE_LAB] || [];
		for (const lab of labs) {
			if (room.boostManager.isLabUsedForBoosting(lab.id)) continue;

			if (lab.store[RESOURCE_ENERGY] > 0) {
				options.push({
					priority: 3,
					weight: 0,
					type: 'structure',
					object: lab,
					resourceType: RESOURCE_ENERGY,
				});
			}

			if (lab.mineralType) {
				options.push({
					priority: 3,
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
			creep.room.visual.text('no source :(', creep.pos);
			return;
		}

		creep.room.visual.text('source: ' + best.type + '@' + best.priority, creep.pos);

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
