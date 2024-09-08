/* global PathFinder Room RoomPosition FIND_DROPPED_RESOURCES
STRUCTURE_CONTAINER RESOURCE_POWER RESOURCE_GHODIUM STRUCTURE_LAB REACTIONS
STRUCTURE_EXTENSION STRUCTURE_SPAWN STRUCTURE_TOWER STRUCTURE_NUKER ERR_NO_PATH
STRUCTURE_POWER_SPAWN TERRAIN_MASK_WALL LOOK_STRUCTURES RESOURCE_ENERGY
LOOK_CONSTRUCTION_SITES OK ORDER_SELL FIND_TOMBSTONES FIND_RUINS */

import Role from 'role/role';
import utilities from 'utilities';
import {getResourcesIn} from 'utils/store';

type TransporterOrder = ResourceSourceTask | ResourceDestinationTask;

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
		idlingFor?: number;
	}
}

function isTargettedOrder(order: TransporterOrder): order is (StructureDestinationTask | StructureSourceTask) {
	return 'target' in order;
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

		// Make sure transporter doesn't have orders outside of its room.
		if (creep.memory.singleRoom && creep.memory.order && isTargettedOrder(creep.memory.order)) {
			const target = Game.getObjectById<RoomObject & _HasId>(creep.memory.order.target);
			if (target && target.pos && target.pos.roomName !== creep.memory.singleRoom) {
				this.setDelivering(creep.memory.delivering);
			}
		}

		// Wait if there are no tasks to do.
		if ((creep.heapMemory.idlingFor || 0) > 0) {
			creep.heapMemory.idlingFor--;
			creep.whenInRange(1, creep, () => {});
			creep.say(`⌛${creep.heapMemory.idlingFor}`);
			return;
		}

		if (
			creep.store.getUsedCapacity() >= creep.store.getCapacity() * 0.9
			&& !creep.memory.order
			&& !creep.memory.delivering
		) {
			this.setDelivering(true);
		}
		else if (
			creep.store.getUsedCapacity() <= creep.store.getCapacity() * 0.1
			&& creep.memory.delivering
			&& !creep.memory.order
			&& !_.some(getResourcesIn(creep.store), resourceType => resourceType !== RESOURCE_ENERGY && creep.store.getUsedCapacity(resourceType) > 0)
		) {
			this.setDelivering(false);
		}

		if (this.unblockBayIfNeeded(creep)) return;

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
	setDelivering(delivering: boolean) {
		this.creep.memory.delivering = delivering;
		delete this.creep.memory.order;
	}

	/**
	 * Makes sure creeps don't get stuck in bays.
	 *
	 * @return {boolean}
	 *   True if the creep is trying to get free.
	 */
	unblockBayIfNeeded(creep: Creep): boolean {
		// If the creep is in a bay, but not delivering to that bay (any more), make it move out of the bay forcibly.
		for (const bay of creep.room.bays) {
			if (creep.pos.x !== bay.pos.x || creep.pos.y !== bay.pos.y) continue;
			if (bay.isBlocked()) continue;

			// It's fine if we're explicitly delivering to this bay right now.
			if (creep.memory.order && isResourceDestinationOrder(creep.room, creep.memory.order) && isBayDestinationOrder(creep.memory.order) && creep.memory.order.name === bay.name) continue;

			// It's fine if we're explicitly picking up from this bay right now.
			if (creep.memory.order && isResourceSourceOrder(creep.room, creep.memory.order) && isStructureSourceOrder(creep.memory.order)) {
				const order = creep.memory.order;
				const target = Game.getObjectById(order.target);
				if (order.type === 'overfullExtension' && bay.pos.getRangeTo(target.pos) <= 1) continue;
			}

			// We're standing in a bay that we're not delivering to.
			const exitTiles = bay.getPossibleExitTiles();
			if (exitTiles.length === 1) {
				// Move out of the way.
				const dir = creep.pos.getDirectionTo(exitTiles[0]);
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

		if (!this.ensureDeliveryTaskValidity(creep.memory.order)) {
			creep.whenInRange(1, creep, () => {});
			delete creep.memory.order;
			return;
		}

		const order = creep.memory.order;
		creep.room.destinationDispatcher.executeTask(order, {creep});
		return;
	}

	/**
	 * Makes sure the creep has a valid target for resource delivery.
	 *
	 * @return {boolean}
	 *   True if the target is valid and can receive the needed resource.
	 */
	ensureDeliveryTaskValidity(order: TransporterOrder): order is ResourceDestinationTask {
		const creep = this.creep;

		if (!order) {
			this.calculateDeliveryTarget();
			order = creep.memory.order;
		}

		if (!order) return false;

		if (isResourceDestinationOrder(creep.room, creep.memory.order)) {
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
			if (creep.store.getFreeCapacity() > 0) this.setDelivering(false);
			return;
		}

		creep.room.visual.text('target: ' + creep.memory.order.type + '@' + creep.memory.order.priority, creep.pos);
	}

	/**
	 * Makes this creep collect resources.
	 *
	 * @param {Function} sourceCallback
	 *   Optional callback to use when a new source target needs to be chosen.
	 */
	performGetResources(sourceCallback?: () => void) {
		const creep = this.creep;
		if (!sourceCallback) {
			sourceCallback = () => {
				this.calculateSource();
			};
		}

		if (!this.ensureSourceTaskValidity(creep.memory.order, sourceCallback)) {
			delete creep.memory.order;
			creep.whenInRange(1, creep, () => {});

			if (creep.memory.role === 'transporter') {
				if (creep.store.getUsedCapacity() > creep.store.getCapacity() * 0.1) {
					// Deliver what we already have stored, if no more can be found for picking up.
					this.setDelivering(true);
				}
				else {
					this.setDelivering(false);
				}
			}

			return;
		}

		creep.room.sourceDispatcher.executeTask(creep.memory.order, {creep});
		return;
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
	ensureSourceTaskValidity(order: TransporterOrder, calculateSourceCallback: () => void): order is ResourceSourceTask {
		const creep = this.creep;

		if (!order) {
			calculateSourceCallback();
			order = creep.memory.order;
		}

		if (!order) {
			if (creep.store.getUsedCapacity() > 0) {
				this.setDelivering(true);
				return false;
			}

			creep.heapMemory.idlingFor = 20;
			return false;
		}

		if (isResourceSourceOrder(creep.room, order)) {
			return creep.room.sourceDispatcher.validateTask(order, {creep});
		}

		return false;
	}

	/**
	 * Sets a good resource source target for this creep.
	 */
	calculateSource() {
		const creep = this.creep;
		let bestSource = this.getSource();

		if (creep.room.terminal || creep.room.storage) {
			// It might be more important to pick up a resource needed for a specific task.
			const bestDestination = creep.room.destinationDispatcher.getTask(
				{creep, ignoreStoreContent: true},
				(task: ResourceDestinationTask) => {
					return creep.room.getCurrentResourceAmount(task.resourceType) > 0;
				},
			);
			if (this.destinationHasHigherPriority(bestDestination, bestSource)) {
				// Get source task corresponding to the resource needed for the chosen destination task.
				const source = creep.room.sourceDispatcher.getTask(
					{
						creep,
						resourceType: bestDestination.resourceType,
					},
					(task: ResourceSourceTask) => {
						// Make sure we don't pick up from the same source we're delivering to.
						if (isStructureSourceOrder(task) && isStructureDestinationOrder(bestDestination)) return task.target !== bestDestination.target;

						return true;
					},
				);

				if (source) {
					creep.room.visual.text('for: ' + bestDestination.type + '@' + bestDestination.priority, creep.pos.x, creep.pos.y + 0.8);
					bestSource = source;
				}
				else {
					creep.room.visual.text('no source :(', creep.pos.x, creep.pos.y + 1.6);
					creep.room.visual.text('for: ' + bestDestination.type + '@' + bestDestination.priority, creep.pos.x, creep.pos.y + 0.8);
				}
			}
		}

		if (!bestSource) {
			delete creep.memory.order;
			return;
		}

		creep.room.visual.text('source: ' + bestSource.type + '@' + bestSource.priority, creep.pos);
		creep.memory.order = bestSource;
	}

	/**
	 * Creates a priority list of resources available to this creep.
	 *
	 * @return {Array}
	 *   A list of potential resource sources.
	 */
	getSource(): ResourceSourceTask {
		const creep = this.creep;

		// Don't pick up anything that's not energy if there's no place to store.
		const resourceType = (creep.room.terminal || creep.room.storage) ? null : RESOURCE_ENERGY;
		const dispatcherTask = creep.room.sourceDispatcher.getTask({
			creep,
			resourceType,
		});
		if (dispatcherTask) return dispatcherTask;

		return null;
	}

	/**
	 * Checks if a destination task has higher priority than a source task.
	 *
	 * @param {ResourceDestinationTask} destination
	 *   The destination task to check.
	 * @param {ResourceSourceTask} source
	 *   The source task to check.
	 *
	 * @return {boolean}
	 *   True if the destination task has higher priority.
	 */
	destinationHasHigherPriority(destination: ResourceDestinationTask, source: ResourceSourceTask): boolean {
		if (!destination) return false;
		if (!source) return true;

		if (destination.priority > source.priority) return true;
		if (destination.priority < source.priority) return false;

		return destination.weight > source.weight;
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
	}

	/**
	 * Creates a priority list of energy sources available to this creep.
	 *
	 * @return {Array}
	 *   A list of potential energy sources.
	 */
	getAvailableEnergySources(): ResourceSourceTask[] {
		const creep = this.creep;
		const task = creep.room.sourceDispatcher.getTask({
			creep,
			resourceType: RESOURCE_ENERGY,
		});
		if (task) return [task];

		return [];
	}
}
