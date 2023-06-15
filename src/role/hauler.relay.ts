/* global FIND_DROPPED_RESOURCES RESOURCE_ENERGY OK
ERR_NO_PATH ERR_NOT_IN_RANGE FIND_STRUCTURES STRUCTURE_CONTAINER STRUCTURE_ROAD
FIND_MY_CONSTRUCTION_SITES LOOK_STRUCTURES MAX_CONSTRUCTION_SITES
LOOK_CONSTRUCTION_SITES */

// @todo Collect energy if it's lying on the path.

import hivemind from 'hivemind';
import RemoteMiningOperation from 'operation/remote-mining';
import Role from 'role/role';
import {encodePosition, decodePosition, serializePositionPath} from 'utils/serialization';

declare global {
	interface RelayHaulerCreep extends Creep {
		memory: RelayHaulerCreepMemory;
		heapMemory: RelayHaulerCreepHeapMemory;
		operation: RemoteMiningOperation;
	}

	interface RelayHaulerCreepMemory extends CreepMemory {
		role: 'hauler.relay';
		room: string;
		delivering?: boolean;
		source?: string;
	}

	interface RelayHaulerCreepHeapMemory extends CreepHeapMemory {
		deliveryTarget?: Id<AnyStoreStructure>;
		order?: ResourceDestinationTask;
		energyPickupTarget?: Id<Resource>;
	}
}

export default class RelayHaulerRole extends Role {
	actionTaken: boolean;

	/**
	 * Makes a creep behave like a relay hauler.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: RelayHaulerCreep) {
		if (!hivemind.segmentMemory.isReady()) return;

		const isEmpty = creep.store.getUsedCapacity() === 0;
		const isFull = creep.store.getUsedCapacity() >= creep.store.getCapacity() * 0.9;
		const path = this.getPath(creep);
		const needsToReturn = isFull;
		if (creep.memory.delivering && isEmpty) {
			this.startPickup(creep);
		}
		else if (!creep.memory.delivering && needsToReturn) {
			this.startDelivering(creep);
		}

		if (creep.memory.delivering) {
			this.performDeliver(creep);
			return;
		}

		this.performPickup(creep);
	}

	startPickup(creep: RelayHaulerCreep) {
		delete creep.memory.delivering;
		delete creep.heapMemory.deliveryTarget;

		this.determineTargetSource(creep);
		const path = this.getPath(creep);
		if (!path) return;

		creep.setCachedPath(serializePositionPath(path), true, 1);
	}

	determineTargetSource(creep: RelayHaulerCreep) {
		const harvestPositions = creep.room.getRemoteHarvestSourcePositions();
		const scoredPositions = [];
		for (const position of harvestPositions) {
			scoredPositions.push(this.scoreHarvestPosition(creep, position));
		}

		const bestPosition = _.max(_.filter(scoredPositions, p => p.energy > 0), 'energy');

		if (bestPosition) {
			creep.memory.source = encodePosition(bestPosition.position);
		}
	}

	scoreHarvestPosition(creep: RelayHaulerCreep, position: RoomPosition) {
		const targetPos = encodePosition(position);
		const operation = Game.operationsByType.mining['mine:' + position.roomName];
		const path = operation.getPaths[targetPos];

		const currentEnergy = operation.getEnergyForPickup(targetPos);
		const maxHarvesterLifetime = _.max(
			_.filter(Game.creepsByRole['harvester.remote'], (creep: RemoteHarvesterCreep) => creep.memory.source = targetPos),
			(creep: Creep) => creep.ticksToLive
		).ticksToLive;
		const projectedIncomeDuration = Math.min(maxHarvesterLifetime, path.travelTime);
		const sourceMaxEnergy = operation.canReserveFrom(creep.memory.room) ? SOURCE_ENERGY_CAPACITY : SOURCE_ENERGY_NEUTRAL_CAPACITY;
		const projectedIncome = projectedIncomeDuration * sourceMaxEnergy / ENERGY_REGEN_TIME;

		const queuedHaulerCapacity = _.sum(
			_.filter(Game.creepsByRole['hauler.relay'], (creep: RelayHaulerCreep) => creep.memory.source === targetPos),
			(creep: Creep) => creep.store.getFreeCapacity(RESOURCE_ENERGY)
		);

		return {
			position,
			energy: currentEnergy + projectedIncome - queuedHaulerCapacity,
		};
	}

	startDelivering(creep: RelayHaulerCreep) {
		creep.memory.delivering = true;
		delete creep.memory.source;
		delete creep.heapMemory.deliveryTarget;

		const path = this.getPath(creep);
		if (!path) return;

		creep.setCachedPath(serializePositionPath(path), false, 1);
	}

	getPath(creep: RelayHaulerCreep): RoomPosition[] | null {
		if (!creep.operation) return null;

		const paths = creep.operation.getPaths();
		if (!paths[creep.memory.source] || !paths[creep.memory.source].accessible) return null;

		return paths[creep.memory.source].path;
	}

	/**
	 * Makes a creep deliver resources to another room.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performDeliver(creep: RelayHaulerCreep) {
		const sourceRoom = creep.memory.room;
		if (!Game.rooms[sourceRoom]) return;

		const hasTarget = creep.heapMemory.deliveryTarget && creep.isInRoom();
		if (creep.pos.roomName === sourceRoom || hasTarget) {
			const target = this.getDeliveryTarget(creep); 
			const targetPosition = target ? target.pos : Game.rooms[sourceRoom].getStorageLocation();
			if (!targetPosition) return;

			this.storeResources(creep, target);
			return;
		}

		if (creep.hasCachedPath()) {
			creep.followCachedPath();
		}
	}

	getDeliveryTarget(creep: RelayHaulerCreep) {
		if (creep.heapMemory.deliveryTarget) {
			const target = Game.getObjectById(creep.heapMemory.deliveryTarget);
			if (target) return target;
		}

		const target = Game.rooms[creep.memory.room].getBestStorageTarget(creep.store.energy, RESOURCE_ENERGY);
		if (!target) return null;

		creep.heapMemory.deliveryTarget = target.id;
		return target;
	}

	storeResources(creep: RelayHaulerCreep, target?: AnyStoreStructure) {
		if (!creep.room.storage && !creep.room.terminal) {
			if (!creep.heapMemory.order || !creep.room.destinationDispatcher.validateTask(creep.heapMemory.order, {creep})) {
				creep.heapMemory.order = creep.room.destinationDispatcher.getTask({
					creep,
					resourceType: RESOURCE_ENERGY,
				});
			}

			if (creep.heapMemory.order) {
				creep.room.destinationDispatcher.executeTask(creep.heapMemory.order, {creep});
				return;
			}
		}

		// @todo If no storage is available, use default delivery method.
		if (!target || creep.store[RESOURCE_ENERGY] > target.store.getFreeCapacity(RESOURCE_ENERGY)) {
			this.dropResources(creep);
			return;
		}

		creep.whenInRange(1, target, () => {
			if (creep.transfer(target, RESOURCE_ENERGY) === OK) {
				creep.operation?.addResourceGain(creep.store.energy, RESOURCE_ENERGY);
			}
		});
	}

	dropResources(creep: RelayHaulerCreep) {
		const storageLocation = creep.room.getStorageLocation();
		if (!storageLocation) {
			// If there's no place to deliver, just drop the energy on the spot, somebody will probably pick it up.
			if (creep.drop(RESOURCE_ENERGY) === OK) creep.operation?.addResourceGain(creep.store.energy, RESOURCE_ENERGY);
			return;
		}

		creep.whenInRange(1, storageLocation, () => {
			if (creep.drop(RESOURCE_ENERGY) === OK) {
				creep.operation.addResourceGain(creep.store.energy, RESOURCE_ENERGY);
			}
		});
	}

	/**
	 * Makes a creep get energy from different rooms.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performPickup(creep: RelayHaulerCreep) {
		const sourcePosition = decodePosition(creep.memory.source);

		//@todo Pick up energy / resources directly next to the creep.
		// From drops, tombstones or ruins.

		if (creep.hasCachedPath()) {
			creep.followCachedPath();
			if (creep.hasArrived()) {
				creep.clearCachedPath();
			}
			else if (creep.pos.getRangeTo(sourcePosition) <= 3) {
				creep.clearCachedPath();
			}
			else {
				return;
			}
		}

		if (sourcePosition.roomName !== creep.pos.roomName) {
			creep.moveToRange(sourcePosition, 1);
			return;
		}

		if (this.pickupNearbyEnergy(creep)) return;

		// Get energy from target container.
		if (!creep.operation) {
			// @todo Operation has probably ended. Return home.
			this.startDelivering(creep);
			return;
		}

		const sourceRoom = creep.operation.getSourceRoom(creep.memory.source);
		const container = creep.operation.getContainer(creep.memory.source);
		if (container) {
			creep.whenInRange(1, container, () => {
				const relevantAmountReached = (container.store.energy || 0) >= Math.min(creep.store.getCapacity() / 2, creep.store.getFreeCapacity());
				if (relevantAmountReached) {
					creep.withdraw(container, RESOURCE_ENERGY);
				}
			});
		}
		else if (creep.pos.getRangeTo(sourcePosition) > 2) {
			// If all else fails, make sure we're close enough to our source.
			creep.whenInRange(2, sourcePosition, () => {});
		}
	}

	/**
	 * Picks up dropped energy close to this creep.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @return {boolean}
	 *   True if a pickup was made this tick.
	 */
	pickupNearbyEnergy(creep: RelayHaulerCreep) {
		// @todo Allow hauler to pick up other resources as well, but respect that
		// when delivering.
		// @todo Allow picking up from tombstones and ruins.
		// Check if energy is on the ground nearby and pick that up.
		const resource = this.getNearbyEnergyResource(creep);
		if (!resource) return false;

		creep.whenInRange(1, resource, () => {
			creep.pickup(resource);
		});
		return true;
	}

	getNearbyEnergyResource(creep: RelayHaulerCreep) {
		if (creep.heapMemory.energyPickupTarget) {
			const resource = Game.getObjectById(creep.heapMemory.energyPickupTarget);

			if (resource && resource.pos.roomName === creep.pos.roomName) return resource;

			delete creep.heapMemory.energyPickupTarget;
		}

		// @todo Check if there's a valid (short) path to the resource.
		const resources = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
			filter: resource => resource.resourceType === RESOURCE_ENERGY && resource.amount >= 20,
		});

		if (!resources.length) return null;

		creep.heapMemory.energyPickupTarget = resources[0].id;
		return resources[0];
	}
}
