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
		delivering?: boolean;
		source?: string;
	}

	interface RelayHaulerCreepHeapMemory extends CreepHeapMemory {
		deliveryTarget?: Id<AnyStoreStructure>;
		order?: ResourceDestinationTask;
		energyPickupTarget?: Id<Resource | Tombstone | Ruin>;
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

		if (scoredPositions.length === 0) return;

		const bestPosition = _.max(scoredPositions, 'energy');

		if (bestPosition?.position) {
			creep.memory.source = encodePosition(bestPosition.position);
			creep.memory.operation = 'mine:' + bestPosition.position.roomName;
		}
	}

	scoreHarvestPosition(creep: RelayHaulerCreep, position: RoomPosition) {
		const targetPos = encodePosition(position);
		const operation = Game.operationsByType.mining['mine:' + position.roomName];
		if (!operation || operation.isUnderAttack()) return {position, energy: -1000};

		const path = operation.getPaths()[targetPos];

		const currentEnergy = operation.getEnergyForPickup(targetPos);
		const maxHarvesterLifetime = _.max(
			_.filter(Game.creepsByRole['harvester.remote'], (creep: RemoteHarvesterCreep) => creep.memory.source === targetPos),
			(creep: Creep) => creep.ticksToLive,
		).ticksToLive;
		const projectedIncomeDuration = Math.min(maxHarvesterLifetime, path.travelTime);
		const sourceMaxEnergy = operation.canReserveFrom(creep.memory.sourceRoom) ? SOURCE_ENERGY_CAPACITY : SOURCE_ENERGY_NEUTRAL_CAPACITY;
		const projectedIncome = operation.hasContainer(targetPos) ? projectedIncomeDuration * sourceMaxEnergy / ENERGY_REGEN_TIME : 0;

		const queuedHaulerCapacity = _.sum(
			_.filter(Game.creepsByRole['hauler.relay'], (creep: RelayHaulerCreep) => creep.memory.source === targetPos && !creep.memory.delivering),
			(creep: Creep) => creep.store.getFreeCapacity(RESOURCE_ENERGY),
		);
		const oldHaulerCapacity = _.sum(
			_.filter(Game.creepsByRole.hauler, (creep: HaulerCreep) => creep.memory.source === targetPos && !creep.memory.delivering),
			(creep: Creep) => creep.store.getFreeCapacity(RESOURCE_ENERGY),
		);
		const queuedBuilderCapacity = _.sum(
			_.filter(Game.creepsByRole['builder.mines'], (creep: MineBuilderCreep) => creep.memory.source === targetPos && !creep.memory.returning),
			(creep: Creep) => creep.store.getFreeCapacity(RESOURCE_ENERGY),
		);

		return {
			position,
			energy: currentEnergy + projectedIncome - queuedHaulerCapacity - queuedBuilderCapacity - oldHaulerCapacity,
		};
	}

	startDelivering(creep: RelayHaulerCreep) {
		creep.memory.delivering = true;
		const path = this.getPath(creep);

		delete creep.memory.source;
		delete creep.heapMemory.deliveryTarget;

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
		const sourceRoom = creep.memory.sourceRoom;
		if (!Game.rooms[sourceRoom]) return;

		if (this.performRelay(creep)) return;

		// Transfer energy to nearby mine builders.
		const creeps = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
			filter: creep => ['builder', 'builder.remote', 'builder.mines', 'upgrader'].includes(creep.memory.role) && creep.store.getFreeCapacity(RESOURCE_ENERGY) > creep.store.getCapacity() / 3,
		});
		if (creeps.length > 0) {
			creep.transfer(_.sample(creeps), RESOURCE_ENERGY);
			return;
		}

		if (this.pickupNearbyEnergy(creep)) return;

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
			if (creep.hasArrived()) {
				creep.clearCachedPath();
			}
		}
		else {
			creep.moveToRange(Game.rooms[sourceRoom].getStorageLocation(), 1);
		}
	}

	getDeliveryTarget(creep: RelayHaulerCreep) {
		if (creep.heapMemory.deliveryTarget) {
			const target = Game.getObjectById(creep.heapMemory.deliveryTarget);
			if (target) {
				return target;
			}

			delete creep.heapMemory.deliveryTarget;
		}

		const target = Game.rooms[creep.memory.sourceRoom].getBestStorageTarget(creep.store.energy, RESOURCE_ENERGY);
		if (!target) return null;

		creep.heapMemory.deliveryTarget = target.id;
		return target;
	}

	storeResources(creep: RelayHaulerCreep, target?: AnyStoreStructure) {
		this.transferEnergyToNearbyTargets(creep);

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

	transferEnergyToNearbyTargets(creep: RelayHaulerCreep) {
		const structures = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
			filter: (structure: AnyStoreStructure) => ([STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_TOWER, STRUCTURE_POWER_SPAWN] as string[]).includes(structure.structureType) && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
		});

		if (structures.length > 0) {
			creep.transfer(_.sample(structures), RESOURCE_ENERGY);
			return;
		}

		const creeps = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
			filter: creep => ['builder', 'builder.remote', 'builder.mines', 'upgrader'].includes(creep.memory.role) && creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
		});

		if (creeps.length > 0) {
			creep.transfer(_.sample(creeps), RESOURCE_ENERGY);
		}
	}

	dropResources(creep: RelayHaulerCreep) {
		const storageLocation = creep.room.getStorageLocation();
		if (!storageLocation) {
			// If there's no place to deliver, just drop the energy on the spot, somebody will probably pick it up.
			if (creep.drop(RESOURCE_ENERGY) === OK) {
				creep.operation?.addResourceGain(creep.store.energy, RESOURCE_ENERGY);
			}

			return;
		}

		creep.whenInRange(0, storageLocation, () => {
			if (creep.drop(RESOURCE_ENERGY) === OK) {
				creep.operation.addResourceGain(creep.store.energy, RESOURCE_ENERGY);
			}
		});
	}

	performRelay(creep: RelayHaulerCreep) {
		if (!creep.hasCachedPath()) return false;

		return false;
	}

	/**
	 * Makes a creep get energy from different rooms.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performPickup(creep: RelayHaulerCreep) {
		creep.say('p0');
		const sourcePosition = decodePosition(creep.memory.source);
		if (!sourcePosition) {
			creep.say('newtar');
			this.startPickup(creep);
			return;
		}

		// Pick up energy / resources directly next to the creep.
		// From drops, tombstones or ruins.
		if (this.pickupNearbyEnergy(creep)) {
			creep.say('ene'); return;
		}

		if (creep.hasCachedPath()) {
			creep.say('follow');
			creep.followCachedPath();
			if (creep.hasArrived()) {
				creep.clearCachedPath();
			}
			else if (creep.pos.roomName === sourcePosition.roomName && creep.pos.getRangeTo(sourcePosition) <= 3) {
				creep.clearCachedPath();
			}
			else {
				return;
			}
		}

		creep.say('p1');

		if (sourcePosition.roomName !== creep.pos.roomName) {
			creep.moveToRange(sourcePosition, 1);
			return;
		}

		// Get energy from target container.
		if (!creep.operation) {
			// @todo Operation has probably ended. Return home.
			// this.startDelivering(creep);
			return;
		}

		creep.say('p2');

		const container = creep.operation.getContainer(creep.memory.source);
		if (container) {
			creep.say('container');

			const hasActiveHarvester = _.some(creep.room.creepsByRole['harvester.remote'], (harvester: RemoteHarvesterCreep) => {
				if (harvester.memory.source !== creep.memory.source) return false;
				if (harvester.pos.roomName !== container.pos.roomName) return false;
				if (harvester.pos.getRangeTo(container.pos) > 3) return false;

				return true;
			});
			if (!hasActiveHarvester && container.store.getUsedCapacity(RESOURCE_ENERGY) < 20) {
				this.startDelivering(creep);
				return;
			}

			creep.whenInRange(1, container, () => {
				const relevantAmountReached = (container.store.energy || 0) >= Math.min(creep.store.getCapacity() / 2, creep.store.getFreeCapacity());
				if (relevantAmountReached) {
					creep.withdraw(container, RESOURCE_ENERGY);
				}

				if (!hasActiveHarvester) {
					creep.withdraw(container, RESOURCE_ENERGY);
					this.startDelivering(creep);
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
		if (creep.store.getFreeCapacity() === 0) return false;
		if (creep.room.isMine()) return false;

		// @todo Allow hauler to pick up other resources as well, but respect that
		// when delivering.
		// @todo Allow picking up from tombstones and ruins.
		// Check if energy is on the ground nearby and pick that up.
		const target = this.getNearbyEnergyTarget(creep);
		if (target) {
			creep.whenInRange(1, target, () => {
				if (target instanceof Resource) {
					creep.pickup(target);
				}
				else {
					creep.withdraw(target, RESOURCE_ENERGY);
				}
			});
			return true;
		}

		return false;
	}

	getNearbyEnergyTarget(creep: RelayHaulerCreep) {
		if (creep.heapMemory.energyPickupTarget) {
			const target = Game.getObjectById(creep.heapMemory.energyPickupTarget);

			if (target && target.pos.roomName === creep.pos.roomName && ((target instanceof Resource) || target.store.getUsedCapacity(RESOURCE_ENERGY) >= 20)) {
				return target;
			}

			delete creep.heapMemory.energyPickupTarget;
		}

		// @todo Check if there's a valid (short) path to the resource.
		const resources = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
			filter: resource => resource.resourceType === RESOURCE_ENERGY && resource.amount >= 20,
		});

		if (resources.length > 0) {
			creep.heapMemory.energyPickupTarget = resources[0].id;
			return resources[0];
		}

		const tombstone = creep.pos.findInRange(FIND_TOMBSTONES, 3, {
			filter: tombstone => tombstone.store.getUsedCapacity(RESOURCE_ENERGY) >= 20,
		});

		if (tombstone.length > 0) {
			creep.heapMemory.energyPickupTarget = tombstone[0].id;
			return tombstone[0];
		}

		const ruin = creep.pos.findInRange(FIND_RUINS, 3, {
			filter: ruin => ruin.store.getUsedCapacity(RESOURCE_ENERGY) >= 20,
		});

		if (ruin.length > 0) {
			creep.heapMemory.energyPickupTarget = ruin[0].id;
			return ruin[0];
		}

		return null;
	}
}
