/* global FIND_DROPPED_RESOURCES RESOURCE_ENERGY OK
ERR_NO_PATH ERR_NOT_IN_RANGE FIND_STRUCTURES STRUCTURE_CONTAINER STRUCTURE_ROAD
FIND_MY_CONSTRUCTION_SITES LOOK_STRUCTURES MAX_CONSTRUCTION_SITES
LOOK_CONSTRUCTION_SITES */

// @todo Collect energy if it's lying on the path.

import cache from 'utils/cache';
import hivemind from 'hivemind';
import RemoteMiningOperation from 'operation/remote-mining';
import Role from 'role/role';
import {encodePosition, decodePosition, serializePositionPath} from 'utils/serialization';

declare global {
	interface MineBuilderCreep extends Creep {
		memory: MineBuilderCreepMemory;
		heapMemory: MineBuilderCreepHeapMemory;
		operation: RemoteMiningOperation;
	}

	interface MineBuilderCreepMemory extends CreepMemory {
		role: 'builder.mines';
		delivering: boolean;
		source: string;
	}

	interface MineBuilderCreepHeapMemory extends CreepHeapMemory {
		energyPickupTarget: string;
	}
}

export default class MineBuilderRole extends Role {
	actionTaken: boolean;

	/**
	 * Makes a creep behave like a mine builder.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: MineBuilderCreep) {
		if (!hivemind.segmentMemory.isReady()) return;

		if (creep.heapMemory.suicideSpawn) {
			this.performRecycle(creep);
		}

		const isEmpty = creep.store.getUsedCapacity() === 0;
		const isFull = creep.store.getUsedCapacity() >= creep.store.getCapacity() * 0.9;
		const path = this.getPath(creep);
		if (creep.memory.delivering && isEmpty) {
			// @todo Determine if it's faster to go home, or to the source.
			this.setBuildState(creep, false);
		}
		else if (!creep.memory.delivering && isFull) {
			this.setBuildState(creep, true);
		}

		if (!creep.memory.source) {
			if (creep.pos.roomName !== creep.memory.sourceRoom) {
				creep.interRoomTravel(new RoomPosition(25, 25, creep.memory.sourceRoom));
			}
			else {
				creep.whenInRange(3, creep.room.storage || creep.room.terminal || creep.room.getStorageLocation(), () => {
					// Wait until there's something to do.
					this.determineTargetSource(creep);
				});
			}

			return;
		}

		if (creep.memory.delivering) {
			// Repair / build roads on the way home.

			if (this.performBuildRoad(creep)) return;

			this.performReturnHome(creep);
			return;
		}

		this.performGoToSource(creep);
	}

	/**
	 * Puts this creep into or out of delivery mode.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {boolean} delivering
	 *   Whether this creep should be delivering it's carried resources.
	 */
	setBuildState(creep: MineBuilderCreep, delivering: boolean) {
		creep.memory.delivering = delivering;

		if (!delivering) {
			this.determineTargetSource(creep);
		}

		const path = this.getPath(creep);
		if (!path) return;

		creep.setCachedPath(serializePositionPath(path), !delivering, 1);
	}

	determineTargetSource(creep: MineBuilderCreep) {
		delete creep.memory.source;
		const harvestPositions = creep.room.getRemoteHarvestSourcePositions();
		const scoredPositions = [];
		for (const position of harvestPositions) {
			scoredPositions.push(this.scoreHarvestPosition(creep, position));
		}

		const bestPosition = _.max(_.filter(scoredPositions, p => p.work > 0), 'work');

		if (bestPosition) {
			creep.memory.source = encodePosition(bestPosition.position);
		}
	}

	scoreHarvestPosition(creep: MineBuilderCreep, position: RoomPosition) {
		const targetPos = encodePosition(position);
		const operation = Game.operationsByType.mining['mine:' + position.roomName];
		const path = operation.getPaths()[targetPos];

		const hasBuilder = _.filter(Game.creepsByRole['builder.mines'], (c: MineBuilderCreep) => c.memory.source === targetPos).length > 0;
		if (hasBuilder) return {position, work: 0};

		const hasHarvester = _.filter(Game.creepsByRole['harvester.remote'], (c: RemoteHarvesterCreep) => c.memory.source === targetPos).length > 0;
		if (!hasHarvester) return {position, work: 0};

		const neededWork = operation.getNeededWork(targetPos);

		return {
			position,
			work: neededWork,
		};
	}

	getPath(creep: MineBuilderCreep): RoomPosition[] | null {
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
	performReturnHome(creep: MineBuilderCreep) {
		if (!creep.operation) {
			// @todo Operation has probably ended. Return home and suicide?
			return;
		}

		// Refill at container if we emptied ourselves too much repairing it.
		const container = creep.operation.getContainer(creep.memory.source);
		if (container && container.pos.roomName === creep.pos.roomName && creep.pos.getRangeTo(container) < 10) {
			const path = this.getPath(creep);
			const isDying = path && creep.ticksToLive <= path.length;

			if (
				creep.store.getUsedCapacity() < creep.store.getCapacity() * 0.5 &&
				container.store.getUsedCapacity() > container.store.getCapacity() * 0.1 &&
				!isDying
			) {
				// If we're close to source container, make sure we fill up before
				// returning home.
				this.setBuildState(creep, false);
			}
		}

		const sourceRoom = creep.operation.getSourceRoom(creep.memory.source);
		if (!Game.rooms[sourceRoom]) return;

		if (creep.room.name === sourceRoom) {
			const target = creep.room.getBestStorageSource(RESOURCE_ENERGY);
			creep.whenInRange(1, target, () => {
				if (creep.withdraw(target, RESOURCE_ENERGY) === OK) this.setBuildState(creep, false);
			});

			return;
		}

		if (creep.hasCachedPath()) {
			creep.followCachedPath();
			if (creep.hasArrived()) {
				creep.clearCachedPath();
			}
			else {
				return;
			}
		}
	}

	/**
	 * Makes a creep get energy from different rooms.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performGoToSource(creep: MineBuilderCreep) {
		const sourcePosition = decodePosition(creep.memory.source);

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
		else if (creep.pos.roomName !== sourcePosition.roomName || creep.pos.getRangeTo(sourcePosition) > 10) {
			// This creep _should_ be on a cached path!
			// It probably just spawned.
			this.setBuildState(creep, false);
			return;
		}

		if (sourcePosition.roomName !== creep.pos.roomName) {
			creep.moveToRange(sourcePosition, 1);
			return;
		}

		const actionTaken = this.pickupNearbyEnergy(creep);

		// Get energy from target container.
		if (!creep.operation) {
			// @todo Operation has probably ended. Return home and suicide?
			return;
		}

		const sourceRoom = creep.operation.getSourceRoom(creep.memory.source);
		const container = creep.operation.getContainer(creep.memory.source);
		if (container) {
			creep.whenInRange(1, container, () => {
				const relevantAmountReached = (container.store.energy || 0) >= Math.min(creep.store.getCapacity() / 2, creep.store.getFreeCapacity());
				if (!actionTaken && relevantAmountReached) {
					creep.withdraw(container, RESOURCE_ENERGY) === OK;
				}
			});
		}
		else if (creep.pos.getRangeTo(sourcePosition) > 2) {
			// If all else fails, make sure we're close enough to our source.
			creep.whenInRange(2, sourcePosition, () => {});
		}

		// Repair / build roads, even when just waiting for more energy.
		if (!actionTaken && sourceRoom !== creep.pos.roomName && !creep.room.isMine()) {
			this.performBuildRoad(creep);
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
	pickupNearbyEnergy(creep: MineBuilderCreep) {
		// @todo Allow hauler to pick up other resources as well, but respect that
		// when delivering.
		// Check if energy is on the ground nearby and pick that up.
		let resource;
		if (creep.heapMemory.energyPickupTarget) {
			resource = Game.getObjectById(creep.heapMemory.energyPickupTarget);

			if (!resource) {
				delete creep.heapMemory.energyPickupTarget;
			}
			else if (resource.pos.roomName !== creep.pos.roomName) {
				resource = null;
				delete creep.heapMemory.energyPickupTarget;
			}
		}

		if (!resource) {
			// @todo Check if there's a valid (short) path to the resource.
			const resources = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 3, {
				filter: resource => resource.resourceType === RESOURCE_ENERGY && resource.amount >= 100,
			});
			if (resources.length > 0) {
				resource = resources[0];
				creep.heapMemory.energyPickupTarget = resource.id;
			}
		}

		if (resource) {
			if (creep.pos.getRangeTo(resource) > 1) {
				creep.moveToRange(resource, 1);
				return false;
			}

			creep.pickup(resource);
			return true;
		}

		return false;
	}

	/**
	 * Makes the creep build a road under itself on its way home.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @return {boolean}
	 *   Whether or not an action for building this road has been taken.
	 */
	performBuildRoad(creep: MineBuilderCreep) {
		const workParts = creep.getActiveBodyparts(WORK);
		if (workParts === 0) return false;

		if ((creep.store[RESOURCE_ENERGY] || 0) === 0) return false;

		if (!creep.operation) return false;

		const sourceRoom = creep.operation.getSourceRoom(creep.memory.source);
		const sourceRoomLevel = Game.rooms[sourceRoom] ? Game.rooms[sourceRoom].controller.level : 0;
		const buildRoads = sourceRoomLevel > 3;

		this.actionTaken = false;

		if (creep.memory.cachedPath && buildRoads) {
			if (this.buildRoadOnCachedPath(creep)) return true;
		}
		else if (this.repairNearby(creep)) return true;

		// Check source container and repair that, too.
		if (this.ensureRemoteHarvestContainerIsBuilt(creep)) return true;

		if (this.buildNearby(creep)) return true;

		return false;
	}

	/**
	 * Builds and repairs roads along the creep's cached path.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @return {boolean}
	 *   Whether the creep should stay on this spot for further repairs.
	 */
	buildRoadOnCachedPath(creep: MineBuilderCreep) {
		// Don't try to build roads in rooms owned by other players.
		if (creep.room.controller && creep.room.controller.owner && !creep.room.isMine()) return false;

		const workParts = creep.getActiveBodyparts(WORK);
		const pos = creep.memory.cachedPath.position;
		const path = creep.getCachedPath();

		for (let i = pos - 2; i <= pos + 2; i++) {
			if (i < 0 || i >= path.length) continue;

			const position = path[i];
			if (position.roomName !== creep.pos.roomName) continue;

			// Check for roads around the current path position to repair.
			let tileHasRoad = false;
			const structures = position.lookFor(LOOK_STRUCTURES);
			for (const structure of structures) {
				if (structure.structureType !== STRUCTURE_ROAD) continue;

				tileHasRoad = true;

				if (structure.hits < structure.hitsMax - (workParts * REPAIR_POWER)) {
					// Many repairs to do, so stay here for next tick.
					if (this.actionTaken) return true;

					if (creep.repair(structure) === OK) {
						creep.operation.addResourceCost(workParts * REPAIR_COST * REPAIR_POWER, RESOURCE_ENERGY);
						this.actionTaken = true;
					}

					// If structure is especially damaged, stay here to keep repairing.
					if (structure.hits < structure.hitsMax - (workParts * 2 * REPAIR_POWER)) {
						return true;
					}

					break;
				}
			}

			// In our owned rooms, the room manager will place construction sites.
			if (creep.room.isMine()) continue;

			// Create construction site in remote rooms.
			if (!tileHasRoad && _.size(Game.constructionSites) < MAX_CONSTRUCTION_SITES * 0.7) {
				const sites = position.lookFor(LOOK_CONSTRUCTION_SITES);
				const numSites = _.filter(Game.constructionSites, site => site.pos.roomName === position.roomName).length;
				if (sites.length === 0 && numSites < 5) {
					if (position.createConstructionSite(STRUCTURE_ROAD) === OK) {
						// Stay here to build the new construction site.
						return true;
					}
				}
			}
		}

		return false;
	}

	repairNearby(creep: MineBuilderCreep): boolean {
		const workParts = creep.getActiveBodyparts(WORK);
		const needsRepair = creep.pos.findClosestByRange(FIND_STRUCTURES, {
			filter: structure => (structure.structureType === STRUCTURE_ROAD || structure.structureType === STRUCTURE_CONTAINER) && structure.hits < structure.hitsMax - (workParts * 100),
		});
		if (needsRepair && creep.pos.getRangeTo(needsRepair) <= 3) {
			if (creep.repair(needsRepair) === OK) {
				creep.operation.addResourceCost(workParts, RESOURCE_ENERGY);
				this.actionTaken = true;
			}

			// If structure is especially damaged, stay here to keep repairing.
			if (needsRepair.hits < needsRepair.hitsMax - (workParts * 2 * 100)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Repairs or constructs a container near the source we're mining.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @return {boolean}
	 *   Whether the creep should stay on this spot for further repairs.
	 */
	ensureRemoteHarvestContainerIsBuilt(creep: MineBuilderCreep) {
		if (!(creep.operation instanceof RemoteMiningOperation)) return false;
		if ((creep.store.energy || 0) === 0) return false;

		const workParts = creep.getActiveBodyparts(WORK) || 0;
		if (workParts === 0) return false;

		if (creep.operation.hasContainer(creep.memory.source)) {
			// Make sure container is in good condition.
			const container = creep.operation.getContainer(creep.memory.source);
			if (container) {
				if (creep.pos.getRangeTo(container) > 3 || container.hits > container.hitsMax - (workParts * 100)) return false;

				// Many repairs to do, so stay here for next tick.
				if (this.actionTaken) return true;

				if (creep.repair(container) === OK) {
					creep.operation.addResourceCost(workParts, RESOURCE_ENERGY);
					this.actionTaken = true;
				}

				// If structure is especially damaged, stay here to keep repairing.
				if (container.hits < container.hitsMax - (workParts * 2 * 100)) {
					return true;
				}

				return false;
			}
		}

		// Check if there is a container or construction site nearby.
		const containerPosition: RoomPosition = creep.operation.getContainerPosition(creep.memory.source);
		if (!containerPosition || containerPosition.roomName !== creep.pos.roomName) return false;

		const sites = _.filter(containerPosition.lookFor(LOOK_CONSTRUCTION_SITES), site => site.structureType === STRUCTURE_CONTAINER);
		if (sites.length === 0) {
			// Place a container construction site for this source.
			containerPosition.createConstructionSite(STRUCTURE_CONTAINER);
		}

		return false;
	}

	buildNearby(creep: MineBuilderCreep): boolean {
		const workParts = creep.getActiveBodyparts(WORK);
		const needsBuilding = creep.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES, {
			filter: site => site.structureType === STRUCTURE_CONTAINER || site.structureType === STRUCTURE_ROAD,
		});
		if (needsBuilding && creep.pos.getRangeTo(needsBuilding) <= 3) {
			if (this.actionTaken) {
				// Try again next time.
				return true;
			}

			if (creep.build(needsBuilding) === OK) {
				const buildCost = Math.min(creep.store.energy || 0, workParts * 5, needsBuilding.progressTotal - needsBuilding.progress);
				creep.operation.addResourceCost(buildCost, RESOURCE_ENERGY);
				this.actionTaken = true;
			}

			// Stay here if more building is needed.
			if (needsBuilding.progressTotal - needsBuilding.progress > workParts * 10) {
				return true;
			}
		}

		return false;
	}
}
