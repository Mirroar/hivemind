/* global STRUCTURE_ROAD OK RESOURCE_ENERGY LOOK_CREEPS
STRUCTURE_CONTAINER FIND_SOURCES LOOK_CONSTRUCTION_SITES
FIND_MY_CONSTRUCTION_SITES */

import CombatManager from 'creep/combat-manager';
import container from 'utils/container';
import RemoteMiningOperation from 'operation/remote-mining';
import Role from 'role/role';
import {decodePosition, serializePositionPath} from 'utils/serialization';

declare global {
	interface RemoteHarvesterCreep extends Creep {
		memory: RemoteHarvesterCreepMemory;
		heapMemory: RemoteHarvesterCreepHeapMemory;
		operation: RemoteMiningOperation;
	}

	interface RemoteHarvesterCreepMemory extends CreepMemory {
		role: 'harvester.remote';
		source: string;
	}

	interface RemoteHarvesterCreepHeapMemory extends CreepHeapMemory {
	}
}

export default class RemoteHarvesterRole extends Role {
	private combatManager: CombatManager;

	constructor() {
		super();

		this.combatManager = container.get('CombatManager');

		// Remote harvesters have slighly higher priority, since they don't use much
		// cpu once they are harvesting.
		this.throttleAt = 5000;
		this.stopAt = 2000;
	}

	/**
	 * Makes a creep behave like a remote harvester.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: RemoteHarvesterCreep) {
		if (!creep.operation) {
			// @todo Operation has probably ended. Return home and suicide?
			return;
		}

		if (this.travelToSource(creep)) return;
		this.performRemoteHarvest(creep);
	}

	/**
	 * Makes the creep move toward its targeted source.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @returns {boolean}
	 *   Whether the creep is in the process of moving.
	 */
	travelToSource(creep: RemoteHarvesterCreep) {
		const sourcePosition = decodePosition(creep.memory.source);

		if (this.combatManager.needsToFlee(creep)) {
			this.combatManager.performFleeTowards(creep, sourcePosition, 1);
			return true;
		}

		if (creep.pos.roomName !== creep.operation.getRoom() && !creep.hasCachedPath()) {
			const paths = creep.operation.getPaths();
			if (!paths[creep.memory.source]?.accessible) {
				// We need to wait for the path to be accessible again.
				creep.whenInRange(1, creep.pos, () => {});
				
				return false;
			}

			creep.setCachedPath(serializePositionPath(paths[creep.memory.source].path), true, 1);
		}

		if (creep.hasCachedPath()) {
			if (
				creep.hasArrived()
				|| creep.pos.getRangeTo(sourcePosition) < 3
				|| (creep.pos.roomName === creep.operation.getRoom() && this.getSource(creep)?.isDangerous() && creep.pos.getRangeTo(sourcePosition) < 10)
			) {
				creep.clearCachedPath();
			}
			else {
				creep.followCachedPath();
				return true;
			}
		}

		if (sourcePosition.roomName !== creep.pos.roomName) {
			creep.moveToRange(sourcePosition, 1);
			return true;
		}

		return false;
	}

	/**
	 * Makes the creep harvest resources outside of owned rooms.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performRemoteHarvest(creep: RemoteHarvesterCreep) {
		if (creep.pos.roomName !== creep.operation.getRoom()) return;

		// Check if something blocks building the container.
		const container = creep.operation.getContainer(creep.memory.source);
		if (!container) {
			const containerPosition = creep.operation.getContainerPosition(creep.memory.source);
			if (containerPosition) {
				const structures = containerPosition.lookFor(LOOK_STRUCTURES).filter(s => (OBSTACLE_OBJECT_TYPES as string[]).includes(s.structureType));
				if (structures.length > 0) {
					// Dismantle blocking structures.
					creep.whenInRange(1, structures[0], () => {
						creep.dismantle(structures[0]);
					});

					return;
				}
			}
		}

		// Check if a container nearby is in need of repairs, since we can handle
		// it with less intents than haulers do.
		const workParts = creep.getActiveBodyparts(CARRY) ? creep.getActiveBodyparts(WORK) : 0;
		const needsBuild = creep.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES, {
			// It's important we build nearby roads as their sites may prevent the
			// container construction site from being placed.
			filter: site => (site.structureType === STRUCTURE_CONTAINER) || (site.structureType === STRUCTURE_ROAD),
		});
		if (needsBuild && creep.pos.getRangeTo(needsBuild) <= 3) {
			if (creep.store.energy >= Math.min(workParts * 5, creep.store.getCapacity()) && workParts > 0) {
				const result = creep.build(needsBuild);
				if (result === OK) {
					return;
				}
			}
			else {
				const energy = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 1, {
					filter: resource => resource.resourceType === RESOURCE_ENERGY,
				});
				if (energy.length > 0) creep.pickup(energy[0]);
			}
		}

		if (this.repairNearbyContainer(creep)) return;

		const source = this.getSource(creep);

		// Keep away from source keepers.
		if (source.isDangerous()) {
			if (creep.pos.getRangeTo(source) < 5 || creep.pos.getRangeTo(source.getNearbyLair()) < 5) {
				// @todo To save cpu, just move back along remote path.
				creep.whenInRange(5, new RoomPosition(25, 25, creep.pos.roomName), () => {});
				return;
			}

			creep.whenInRange(6, source, () => {});

			// @todo We might consider repairing nearby infrastructure.

			return;
		}

		let moveTarget: RoomObject = source;
		let moveRange = 1;
		if ((creep.operation instanceof RemoteMiningOperation)) {
			const container = creep.operation.getContainer(creep.memory.source);
			const creepsOnContainer = container && container.pos.lookFor(LOOK_CREEPS).length > 0;

			// Move onto container when possible.
			if (container && !creepsOnContainer) {
				moveTarget = container;
				moveRange = 0;
			}

			// Transfer energy to container if we can't drop directly onto it.
			if (
				container
				&& creep.pos.getRangeTo(container.pos) === 1
				&& creep.store.getFreeCapacity() < creep.getActiveBodyparts(WORK) * HARVEST_POWER
				&& creepsOnContainer
			) {
				creep.transfer(container, RESOURCE_ENERGY);
			}
		}

		creep.whenInRange(moveRange, moveTarget, () => {
			// Wait if source is depleted.
			if (source.energy <= 0) return;

			if (this.mayHarvest(creep, source)) creep.harvest(source);

			// Immediately deposit energy if a container is nearby.
			if (!(creep.operation instanceof RemoteMiningOperation)) return;
			if (!creep.operation.hasContainer(creep.memory.source)) {
				// Check if there is a construction site nearby.
				const containerPosition = creep.operation.getContainerPosition(creep.memory.source);
				if (!containerPosition) return;
				const sites = _.filter(containerPosition.lookFor(LOOK_CONSTRUCTION_SITES), (site: ConstructionSite) => site.structureType === STRUCTURE_CONTAINER);
				if (sites.length === 0) {
					// Place a container construction site for this source.
					containerPosition.createConstructionSite(STRUCTURE_CONTAINER);
				}
			}
		});
	}

	getSource(creep: RemoteHarvesterCreep): Source {
		const sourcePosition = decodePosition(creep.memory.source);
		return creep.room.find(FIND_SOURCES, {
			filter: source => source.pos.x === sourcePosition.x && source.pos.y === sourcePosition.y,
		})[0];
	}

	mayHarvest(creep: RemoteHarvesterCreep, source: Source): boolean {
		// Hit fully regenerated sources to start regeneration timer ASAP.
		if (source.energy === source.energyCapacity) return true;

		const harvestPower = creep.getActiveBodyparts(WORK) * HARVEST_POWER;

		// Always harvest if we can carry the resource.
		if (creep.store.getFreeCapacity() >= harvestPower) return true;

		// If we don't have a container, always harvest as soon as possible.
		if (!(creep.operation instanceof RemoteMiningOperation)) return true;
		if (!creep.operation.hasContainer(creep.memory.source)) return true;

		const container = creep.operation.getContainer(creep.memory.source);
		if (!container) return true;

		// If creep storage is full, only harvest when on container so we don't
		// unnecessarily drop resources on the ground.
		if (creep.pos.getRangeTo(container.pos) > 0) return false;

		// Only harvest if container still has capacity.
		if (container.store.getFreeCapacity() >= harvestPower) return true;

		// Any additional resources will drop to the ground, so only harvest
		// if we would otherwise lose energy to the regeneration timer.
		const ticksToHarvestFully = Math.ceil(source.energy / harvestPower);
		if (source.ticksToRegeneration <= ticksToHarvestFully) return true;

		return false;
	}

	repairNearbyContainer(creep: RemoteHarvesterCreep): boolean {
		const workParts = creep.getActiveBodyparts(CARRY) ? creep.getActiveBodyparts(WORK) : 0;
		if (workParts === 0) return false;
		if (creep.store.energy < workParts) return false;
		if (!creep.operation.hasContainer(creep.memory.source)) return false;

		const needsRepair = _.filter(
			creep.room.structuresByType[STRUCTURE_CONTAINER],
			// Repair if possible so we can save on dedicated builders.
			structure =>
				structure.hits <= structure.hitsMax - (workParts * REPAIR_POWER)
				&& creep.pos.getRangeTo(structure.pos) <= 3
				&& creep.operation.getContainerPosition(creep.memory.source)?.isEqualTo(structure.pos),
		);
		if (needsRepair.length > 0) {
			const result = creep.repair(needsRepair[0]);
			if (result === OK) {
				return true;
			}
		}

		return false;
	}
}
