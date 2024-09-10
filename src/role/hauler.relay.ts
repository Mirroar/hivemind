/* global FIND_DROPPED_RESOURCES RESOURCE_ENERGY OK LOOK_CONSTRUCTION_SITES
ERR_NO_PATH ERR_NOT_IN_RANGE STRUCTURE_CONTAINER STRUCTURE_ROAD
FIND_MY_CONSTRUCTION_SITES LOOK_STRUCTURES MAX_CONSTRUCTION_SITES */

// @todo Collect energy if it's lying on the path.

import CombatManager from 'creep/combat-manager';
import container from 'utils/container';
import hivemind from 'hivemind';
import RemoteMiningOperation from 'operation/remote-mining';
import Role from 'role/role';
import {encodePosition, decodePosition, serializePositionPath} from 'utils/serialization';
import {getResourcesIn} from 'utils/store';
import cache from 'utils/cache';

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
		pickupTarget?: Id<Resource | Tombstone | Ruin | StructureContainer | ScoreContainer>;
	}
}

export default class RelayHaulerRole extends Role {
	actionTaken: boolean;
	combatManager: CombatManager;

	constructor() {
		super();

		this.actionTaken = false;
		this.combatManager = container.get('CombatManager');
	}

	/**
	 * Makes a creep behave like a relay hauler.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: RelayHaulerCreep) {
		if (!hivemind.segmentMemory.isReady()) return;

		// @todo If empty, but there's no operation, return home and wait (or suicide).

		const isEmpty = creep.store.getUsedCapacity() === 0;
		const isFull = creep.store.getUsedCapacity() >= creep.store.getCapacity() * 0.9;
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
		delete creep.heapMemory.pickupTarget;

		this.determineTargetSource(creep);
		const path = this.getPath(creep);
		if (!path) return;

		creep.setCachedPath(serializePositionPath(path), true, 1);
	}

	determineTargetSource(creep: RelayHaulerCreep) {
		const harvestPositions = Game.rooms[creep.memory.sourceRoom].getRemoteHarvestSourcePositions();
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
		if (!operation) return {position, energy: -1000};

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
		const queuedBuilderCapacity = _.sum(
			_.filter(Game.creepsByRole['builder.mines'], (creep: MineBuilderCreep) => creep.memory.source === targetPos && !creep.memory.returning),
			(creep: Creep) => creep.store.getFreeCapacity(RESOURCE_ENERGY),
		);

		const attackPenalty = operation.isUnderAttack() ? 1000 : 0;

		return {
			position,
			energy: currentEnergy
				+ projectedIncome
				- queuedHaulerCapacity
				- queuedBuilderCapacity
				- attackPenalty,
		};
	}

	startDelivering(creep: RelayHaulerCreep) {
		creep.memory.delivering = true;
		const path = this.getPath(creep);

		delete creep.memory.source;
		delete creep.heapMemory.deliveryTarget;
		delete creep.heapMemory.pickupTarget;

		if (!path) {
			creep.moveToRoom(creep.memory.sourceRoom);

			return;
		}

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
		const room = Game.rooms[sourceRoom];

		if (this.combatManager.needsToFlee(creep)) {
			this.combatManager.performFleeTowards(creep, room.getStorageLocation(), 5);
			return;
		}

		if (this.performRelay(creep)) return;

		// Transfer energy to nearby mine builders.
		if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
			const creeps = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
				filter: creep => ['builder', 'builder.remote', 'builder.mines', 'upgrader'].includes(creep.memory.role) && creep.store.getFreeCapacity(RESOURCE_ENERGY) > creep.store.getCapacity() / 3,
			});
			if (creeps.length > 0) {
				creep.transfer(_.sample(creeps), RESOURCE_ENERGY);
				return;
			}
		}

		if (this.pickupNearbyResources(creep)) return;

		const hasTarget = creep.heapMemory.deliveryTarget && creep.isInRoom();
		if (creep.pos.roomName === sourceRoom || hasTarget) {
			const target = this.getDeliveryTarget(creep);
			const targetPosition = target ? target.pos : room.getStorageLocation();
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
			creep.moveToRange(room.getStorageLocation(), 1);
		}
	}

	getDeliveryTarget(creep: RelayHaulerCreep) {
		if (creep.heapMemory.deliveryTarget) {
			const target = Game.getObjectById(creep.heapMemory.deliveryTarget);
			if (target && target.store.getFreeCapacity() > 0) {
				return target;
			}

			delete creep.heapMemory.deliveryTarget;
		}

		// We might have something other than energy to deliver, but for simplicity's sake we only check for energy here.
		const target = Game.rooms[creep.memory.sourceRoom].getBestStorageTarget(creep.store.getUsedCapacity(), RESOURCE_ENERGY);
		if (!target) return null;

		creep.heapMemory.deliveryTarget = target.id;
		return target;
	}

	storeResources(creep: RelayHaulerCreep, target?: AnyStoreStructure) {
		this.transferEnergyToNearbyTargets(creep);

		if (!creep.room.storage && !creep.room.terminal && creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
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
		if (!target || creep.store.getUsedCapacity() > target.store.getFreeCapacity()) {
			this.dropResources(creep);
			return;
		}

		creep.whenInRange(1, target, () => {
			for (const resourceType of getResourcesIn(creep.store)) {
				if (creep.transfer(target, resourceType) === OK) {
					creep.operation?.addResourceGain(creep.store.getUsedCapacity(resourceType), resourceType);
					break;
				}
			}
		});
	}

	transferEnergyToNearbyTargets(creep: RelayHaulerCreep) {
		if (creep.room.name !== creep.memory.sourceRoom) return;
		if (creep.room.storage || creep.room.terminal) return;
		if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) return;

		const structures = _.filter([
			...(creep.room.myStructuresByType[STRUCTURE_SPAWN] || []),
			...(creep.room.myStructuresByType[STRUCTURE_EXTENSION] || []),
			...(creep.room.myStructuresByType[STRUCTURE_TOWER] || []),
			...(creep.room.myStructuresByType[STRUCTURE_POWER_SPAWN] || []),
		],
		(structure: AnyStoreStructure) =>
			creep.pos.getRangeTo(structure.pos) <= 1
				&& structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
		);

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
			for (const resourceType of getResourcesIn(creep.store)) {
				if (creep.drop(resourceType) === OK) {
					creep.operation?.addResourceGain(creep.store.getUsedCapacity(resourceType), resourceType);
					break;
				}
			}

			return;
		}

		creep.whenInRange(0, storageLocation, () => {
			for (const resourceType of getResourcesIn(creep.store)) {
				if (creep.drop(resourceType) === OK) {
					creep.operation?.addResourceGain(creep.store.getUsedCapacity(resourceType), resourceType);
					break;
				}
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
			this.startDelivering(creep);
			return;
		}

		if (this.combatManager.needsToFlee(creep)) {
			this.combatManager.performFleeTowards(creep, sourcePosition, 1);
			return;
		}

		if (
			creep.pos.roomName === sourcePosition.roomName
			&& this.getSource(creep)?.isDangerous()
			&& creep.pos.getRangeTo(sourcePosition) <= 10
		) {
			if (_.size(creep.room.creepsByRole.skKiller) > 0) {
				// We wait for SK killer to clean up.
				creep.whenInRange(6, sourcePosition, () => {});
			}
			else {
				// Too dangerous, return home.
				this.startDelivering(creep);
			}

			return;
		}

		// Pick up energy / resources directly next to the creep.
		// From drops, tombstones or ruins.
		if (this.pickupNearbyResources(creep)) {
			creep.say('ene'); return;
		}

		if (creep.hasCachedPath()) {
			if (creep.hasArrived()) {
				creep.clearCachedPath();
			}
			else if (creep.pos.roomName === sourcePosition.roomName && creep.pos.getRangeTo(sourcePosition) <= 3) {
				creep.clearCachedPath();
			}
			else {
				creep.say('follow');
				creep.followCachedPath();
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
			// Operation has probably ended. Return home.
			this.startDelivering(creep);
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
				}

				this.startDelivering(creep);
			});
		}
		else if (creep.pos.getRangeTo(sourcePosition) > 2) {
			// If all else fails, make sure we're close enough to our source.
			creep.whenInRange(2, sourcePosition, () => {
				// We've reached the source and there's nothing left to pick up.
				// Return home.
				this.startDelivering(creep);
			});
		}
		else {
			// We're at the source. With no container, and no energy to pick up,
			// return home.
			this.startDelivering(creep);
		}
	}

	getSource(creep: RelayHaulerCreep): Source {
		const sourcePosition = decodePosition(creep.memory.source);
		return creep.room.find(FIND_SOURCES, {
			filter: source => source.pos.x === sourcePosition.x && source.pos.y === sourcePosition.y,
		})[0];
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
	pickupNearbyResources(creep: RelayHaulerCreep) {
		if (creep.store.getFreeCapacity() === 0) return false;
		if (creep.room.isMine()) return false;

		// Check if energy is on the ground nearby and pick that up.
		const target = this.getNearbyResourceTarget(creep);
		if (target) {
			creep.whenInRange(1, target, () => {
				if (target instanceof Resource) {
					creep.pickup(target);
				}
				else {
					for (const resourceType of getResourcesIn(target.store)) {
						if (resourceType !== RESOURCE_ENERGY && !this.hasSourceRoomStorage(creep)) continue;

						creep.withdraw(target, resourceType);
					}
				}
			});
			return true;
		}

		return false;
	}

	getNearbyResourceTarget(creep: RelayHaulerCreep) {
		if (creep.heapMemory.pickupTarget) {
			const target = Game.getObjectById(creep.heapMemory.pickupTarget);

			if (target && target.pos.roomName === creep.pos.roomName && ((target instanceof Resource) || target.store.getUsedCapacity() >= 20)) {
				return target;
			}

			delete creep.heapMemory.pickupTarget;

			// If we just happened to pick up energy from the ground, check if
			// there's also a full container nearby and empty that as well.
			// This prevents overflowing containers from keeping haulers busy
			// picking up spilled energy.
			const container = creep.pos.findInRange(FIND_STRUCTURES, 1, {
				filter: structure => structure.structureType === STRUCTURE_CONTAINER
					&& structure.store.getFreeCapacity() < structure.store.getCapacity() * 0.1
					&& structure.store.getUsedCapacity(RESOURCE_ENERGY) > 100,
			}) as StructureContainer[];
			if (container.length > 0) creep.heapMemory.pickupTarget = container[0].id;
			return container[0];
		}

		// @todo Check if there's a valid (short) path to the resource, or make sure it's on accessible terrain (eg not next to a source keeper).
		const resources = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
			filter: resource => (resource.resourceType === RESOURCE_ENERGY || this.hasSourceRoomStorage(creep)) && resource.amount >= 20,
		});

		if (resources.length > 0) {
			creep.heapMemory.pickupTarget = resources[0].id;
			return resources[0];
		}

		const tombstone = creep.pos.findInRange(FIND_TOMBSTONES, 3, {
			filter: tombstone => (this.hasSourceRoomStorage(creep) ? tombstone.store.getUsedCapacity() : tombstone.store.getUsedCapacity(RESOURCE_ENERGY)) >= 20,
		});

		if (tombstone.length > 0) {
			creep.heapMemory.pickupTarget = tombstone[0].id;
			return tombstone[0];
		}

		const ruin = creep.pos.findInRange(FIND_RUINS, 3, {
			filter: ruin => (this.hasSourceRoomStorage(creep) ? ruin.store.getUsedCapacity() : ruin.store.getUsedCapacity(RESOURCE_ENERGY)) >= 20,
		});

		if (ruin.length > 0) {
			creep.heapMemory.pickupTarget = ruin[0].id;
			return ruin[0];
		}

		if (Game.shard.name === 'shardSeason' && this.hasSourceRoomStorage(creep)) {
			const scoreContainer = creep.pos.findInRange(FIND_SCORE_CONTAINERS, 3, {
				filter: container => container.store.getUsedCapacity(RESOURCE_SCORE) >= 20,
			});

			if (scoreContainer.length > 0) {
				creep.heapMemory.pickupTarget = scoreContainer[0].id;
				return scoreContainer[0];
			}
		}

		return null;
	}

	hasSourceRoomStorage(creep: RelayHaulerCreep) {
		return cache.inHeap('hasSourceRoomStorage:' + creep.memory.sourceRoom, 100, () => {
			const room = Game.rooms[creep.memory.sourceRoom];
			if (!room) return false;

			return !!(room.storage || room.terminal);
		});
	}
}
