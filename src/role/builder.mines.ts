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
		returning: boolean;
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
		// @todo Take from haulers when next to them. Also take from harvesters when building container so they don't have to.
		if (!hivemind.segmentMemory.isReady()) return;

		if (creep.heapMemory.suicideSpawn) {
			this.performRecycle(creep);
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

		if (creep.memory.returning) {
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
	 * @param {boolean} returning
	 *   Whether this creep should be delivering it's carried resources.
	 */
	setReturning(creep: MineBuilderCreep, returning: boolean) {
		creep.memory.returning = returning;

		if (!returning) {
			this.determineTargetSource(creep);
		}

		const path = this.getPath(creep);
		if (!path) return;

		creep.setCachedPath(serializePositionPath(path), !returning, 1);
	}

	determineTargetSource(creep: MineBuilderCreep) {
		delete creep.memory.source;
		const harvestPositions = creep.room.getRemoteHarvestSourcePositions();
		const scoredPositions = [];
		for (const position of harvestPositions) {
			scoredPositions.push(this.scoreHarvestPosition(creep, position));
		}

		if (scoredPositions.length === 0) return;

		const bestPosition = _.max(_.filter(scoredPositions, p => p.work > 0), 'work');

		if (bestPosition?.position) {
			creep.memory.source = encodePosition(bestPosition.position);
			creep.memory.operation = 'mine:' + bestPosition.position.roomName;
		}
	}

	scoreHarvestPosition(creep: MineBuilderCreep, position: RoomPosition) {
		const targetPos = encodePosition(position);
		const operation = Game.operationsByType.mining['mine:' + position.roomName];
		if (!operation || operation.isUnderAttack()) return {position, work: -1000};

		const path = operation.getPaths()[targetPos];

		const hasBuilder = _.some(Game.creepsByRole['builder.mines'], (c: MineBuilderCreep) => c.memory.source === targetPos);
		if (hasBuilder) return {position, work: 0};

		const hasHarvester = _.some(Game.creepsByRole['harvester.remote'], (c: RemoteHarvesterCreep) => c.memory.source === targetPos);
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
		// Refill at container if we emptied ourselves too much repairing it.
		const container = creep.operation?.getContainer(creep.memory.source);
		if (container && container.pos.roomName === creep.pos.roomName && creep.pos.getRangeTo(container) < 10
				&& creep.store.getUsedCapacity() < creep.store.getCapacity() * 0.5
				&& container.store.getUsedCapacity(RESOURCE_ENERGY) > container.store.getCapacity() * 0.1
		) {
			// If we're close to source container, make sure we fill up before
			// returning home.
			creep.whenInRange(1, container, () => {
				creep.withdraw(container, RESOURCE_ENERGY);
			});

			return;
		}

		if (this.pickupNearbyEnergy(creep)) return;

		if (creep.room.name === creep.memory.sourceRoom) {
			if (creep.store.getFreeCapacity() === 0) {
				this.setReturning(creep, false);
				return;
			}

			const target = creep.room.getBestStorageSource(RESOURCE_ENERGY);

			if (target) {
				creep.whenInRange(1, target, () => {
					if (creep.withdraw(target, RESOURCE_ENERGY) === OK) this.setReturning(creep, false);
				});
			}
			else {
				// Wait for energy to become available.
				creep.whenInRange(5, creep.room.getStorageLocation(), () => {});
			}

			return;
		}

		if (creep.hasCachedPath()) {
			creep.followCachedPath();
			if (creep.hasArrived()) {
				creep.clearCachedPath();
			}
			else {}
		}
		else {
			creep.moveToRange(new RoomPosition(25, 25, creep.memory.sourceRoom), 20);
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
			this.performBuildRoad(creep);
			if (creep.hasArrived()) {
				creep.clearCachedPath();
			}
			else {
				return;
			}
		}
		else if (creep.pos.roomName !== sourcePosition.roomName || creep.pos.getRangeTo(sourcePosition) > 10) {
			// This creep _should_ be on a cached path!
			// It probably just spawned.
			creep.moveToRange(sourcePosition, 1);
			return;
		}

		const actionTaken = this.pickupNearbyEnergy(creep);

		if (!creep.operation) {
			// @todo Operation has probably ended. Return home and suicide?
			this.setReturning(creep, true);
			return;
		}

		// Get close to the source and then return home, building and refreshing energy as necessary.
		creep.whenInRange(2, sourcePosition, () => {
			this.setReturning(creep, true);
		});

		// Repair / build roads, even when just waiting for more energy.
		if (!actionTaken && !creep.room.isMine()) {
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
		if (creep.store.getFreeCapacity(RESOURCE_ENERGY) < 20) return false;

		// @todo Allow hauler to pick up other resources as well, but respect that
		// when returning.
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

		this.actionTaken = false;

		if (creep.hasCachedPath()) {
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
		// @todo Get rid of this direct memory access
		const pos = creep.heapMemory.cachedPath.position;
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
				const numberSites = _.filter(Game.constructionSites, site => site.pos.roomName === position.roomName).length;
				if (sites.length === 0 && numberSites < 5 && position.createConstructionSite(STRUCTURE_ROAD) === OK) {
					// Stay here to build the new construction site.
					return true;
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
