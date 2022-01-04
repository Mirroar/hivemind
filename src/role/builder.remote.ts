/* global RoomPosition FIND_SOURCES FIND_STRUCTURES STRUCTURE_SPAWN
FIND_MY_STRUCTURES RESOURCE_ENERGY ERR_NOT_IN_RANGE STRUCTURE_RAMPART
FIND_MY_CONSTRUCTION_SITES STRUCTURE_TOWER FIND_DROPPED_RESOURCES
STRUCTURE_CONTAINER FIND_SOURCES_ACTIVE */

declare global {
	interface RemoteBuilderCreep extends Creep {
		memory: RemoteBuilderCreepMemory,
		heapMemory: RemoteBuilderCreepHeapMemory,
	}

	interface RemoteBuilderCreepMemory extends CreepMemory {
		role: 'builder.remote',
		targetRoom?: string,
	}

	interface RemoteBuilderCreepHeapMemory extends CreepHeapMemory {
	}
}

import hivemind from 'hivemind';
import NavMesh from 'utils/nav-mesh';
import Role from 'role/role';
import TransporterRole from 'role/transporter';
import {encodePosition, decodePosition} from 'utils/serialization';
import {getRoomIntel} from 'intel-management';

export default class RemoteBuilderRole extends Role {
	transporterRole: TransporterRole;
	navMesh: NavMesh;
	creep: RemoteBuilderCreep;

	constructor() {
		super();

		// Military creeps are always fully active!
		this.stopAt = 0;
		this.throttleAt = 0;

		this.transporterRole = new TransporterRole();
		this.navMesh = new NavMesh();
	}

	/**
	 * Runs logic for remote builder creeps.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: RemoteBuilderCreep) {
		this.creep = creep;

		if (creep.memory.targetRoom) {
			if (creep.interRoomTravel(new RoomPosition(25, 25, creep.memory.targetRoom))) return;
			if (creep.pos.roomName !== creep.memory.targetRoom) return;
			creep.memory.singleRoom = creep.memory.targetRoom;
			delete creep.memory.targetRoom;
		}

		if (creep.memory.building && creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
			this.setBuilderState(false);
		}
		else if (!creep.memory.building && creep.store.getFreeCapacity() === 0) {
			this.setBuilderState(true);
		}

		if (creep.memory.extraEnergyTarget) {
			this.collectExtraEnergy();
			return;
		}

		if (!creep.memory.extraEnergyTarget && creep.memory.sourceRoom) {
			// Return to source room if needed.
			if (creep.pos.roomName === creep.memory.sourceRoom) {
				creep.memory.singleRoom = creep.memory.sourceRoom;
				delete creep.memory.sourceRoom;
			}
			else {
				creep.moveToRoom(creep.memory.sourceRoom);
				return;
			}
		}

		if (creep.memory.upgrading) {
			this.performControllerUpgrade();
			return;
		}

		if (creep.memory.building) {
			this.performRemoteBuild();
			return;
		}

		this.performGetRemoteBuilderEnergy();
	}

	/**
	 * Puts this creep into or out of build mode.
	 *
	 * @param {boolean} building
	 *   Whether to start building / repairing or not.
	 */
	setBuilderState(building) {
		this.creep.memory.building = building;
		delete this.creep.memory.buildTarget;
		delete this.creep.memory.repairTarget;
		delete this.creep.memory.resourceTarget;
		delete this.creep.memory.upgrading;
	}

	/**
	 * Spends energy in target room by building, repairing or upgrading.
	 */
	performRemoteBuild() {
		const creep: Creep = this.creep;

		// Try and prevent controller downgrades.
		if (creep.room.isMine() && (creep.room.controller.level < 2 || creep.room.controller.ticksToDowngrade < 500)) {
			creep.memory.upgrading = true;
			return;
		}

		// Help by filling spawn with energy.
		const spawns = creep.room.find<StructureSpawn>(FIND_MY_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_SPAWN,
		});
		if (spawns && spawns.length > 0 && spawns[0].energy < spawns[0].energyCapacity * 0.8) {
			creep.whenInRange(1, spawns[0], () => creep.transfer(spawns[0], RESOURCE_ENERGY));
			return;
		}

		if (this.saveExpiringRamparts()) return;

		if (!creep.memory.buildTarget) {
			this.determineBuildTarget();

			if (!creep.memory.buildTarget && !creep.memory.repairTarget) {
				// Could not set a target for building. Start upgrading instead.
				creep.memory.upgrading = true;
			}
		}

		const target = Game.getObjectById<ConstructionSite>(creep.memory.buildTarget);
		if (target) {
			creep.whenInRange(3, target, () => creep.build(target));
			return;
		}

		// If build target is gone, find a new one next tick.
		delete creep.memory.buildTarget;
	}

	/**
	 * Repairs ramparts that are low on hits, so they don't decay.
	 *
	 * @return {boolean}
	 *   True if we're trying to repair ramparts.
	 */
	saveExpiringRamparts() {
		if (!this.creep.memory.repairTarget) {
			// Make sure ramparts don't break.
			const targets = this.creep.room.find(FIND_MY_STRUCTURES, {
				filter: structure => structure.structureType === STRUCTURE_RAMPART && structure.hits < 10000,
			});
			if (targets.length > 0) {
				this.creep.memory.repairTarget = targets[0].id;
			}
		}

		if (this.creep.memory.repairTarget) {
			const maxRampartHits = this.creep.room.controller.level < 6 ? 15000 : hivemind.settings.get('minWallIntegrity') * 1.1;
			const target = Game.getObjectById<Structure>(this.creep.memory.repairTarget);
			if (!target || (target.structureType === STRUCTURE_RAMPART && target.hits > maxRampartHits)) {
				delete this.creep.memory.repairTarget;
			}

			this.creep.whenInRange(3, target, () => this.creep.repair(target));
			return true;
		}

		return false;
	}

	determineBuildTarget() {
		// Build structures.
		const targets = this.creep.room.find(FIND_MY_CONSTRUCTION_SITES);

		// Build spawns before building anything else.
		const spawnSites = _.filter(targets, structure => structure.structureType === STRUCTURE_SPAWN);
		if (spawnSites.length > 0) {
			this.creep.memory.buildTarget = spawnSites[0].id;
			return;
		}

		// Towers are also very important.
		const towerSites = _.filter(targets, structure => structure.structureType === STRUCTURE_TOWER);
		if (towerSites.length > 0) {
			this.creep.memory.buildTarget = towerSites[0].id;
			return;
		}

		// Build any of our other construction sites.
		const target = this.creep.pos.findClosestByPath(targets);
		if (target) {
			this.creep.memory.buildTarget = target.id;
			return;
		}

		if (this.creep.room.controller.level >= 6) {
			// Make sure ramparts are of sufficient level.
			const lowRamparts = this.creep.room.find(
				FIND_MY_STRUCTURES, {
					filter: structure => structure.structureType === STRUCTURE_RAMPART && structure.hits < hivemind.settings.get('minWallIntegrity')
				}
			);

			if (lowRamparts.length > 0) {
				this.creep.memory.repairTarget = _.min(lowRamparts, 'hits').id;
				return;
			}
		}
	}

	/**
	 * Upgrades the room's controller.
	 */
	performControllerUpgrade() {
		if (this.creep.room.controller.level === 0) {
			this.creep.memory.upgrading = false;
			return;
		}

		this.creep.whenInRange(3, this.creep.room.controller, () => this.creep.upgradeController(this.creep.room.controller));
	}

	/**
	 * Collects energy.
	 */
	performGetRemoteBuilderEnergy() {
		// @todo Switch to using priority list to determine where to get energy.
		const creep = this.creep;

		// Move to source room if necessary.
		const targetPosition = decodePosition(creep.memory.target);
		if (targetPosition && targetPosition.roomName !== creep.pos.roomName) {
			creep.moveToRange(targetPosition, 5);
			return;
		}

		const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
			filter: drop => drop.resourceType === RESOURCE_ENERGY && (drop.amount > creep.store.getCapacity() * 0.3 || (creep.pos.getRangeTo(drop) <= 1 && drop.amount > 20)),
		});
		if (dropped) {
			creep.whenInRange(1, dropped, () => creep.pickup(dropped));
			return;
		}

		if (creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 5000) {
			creep.whenInRange(1, creep.room.storage, () => creep.withdraw(creep.room.storage, RESOURCE_ENERGY));
			return;
		}

		if (!creep.memory.resourceTarget) {
			// Try getting energy from full containers.
			const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
				filter: structure => structure.structureType === STRUCTURE_CONTAINER && (structure.store.energy || 0) > 500,
			});
			if (container) {
				creep.whenInRange(1, container, () => creep.withdraw(container, RESOURCE_ENERGY));
				return;
			}

			// Try get energy from a source.
			const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
			if (source) {
				creep.memory.resourceTarget = source.id;
				delete creep.memory.deliverTarget;
			}
			else {
				// Or even get energy from adjacent rooms if marked.
				this.setExtraEnergyTarget(creep);

				this.transporterRole.performGetEnergy(creep);
				return;
			}
		}

		const best = creep.memory.resourceTarget;
		if (!best) {
			return;
		}

		const source = Game.getObjectById<Source>(best);
		if (!source || source.energy <= 0) {
			creep.memory.resourceTarget = null;
		}

		const result = creep.harvest(source);
		if (result === ERR_NOT_IN_RANGE) {
			const result = creep.moveToRange(source, 1);
			if (!result) {
				creep.memory.resourceTarget = null;
				this.setExtraEnergyTarget(creep);
			}
		}
	}

	/**
	 * Automatically assigns sources of adjacent safe rooms as extra energy targets.
	 */
	setExtraEnergyTarget(creep: RemoteBuilderCreep) {
		if (!hivemind.segmentMemory.isReady()) return;

		const mainIntel = getRoomIntel(creep.pos.roomName);
		const possibleSources: RoomPosition[] = [];
		for (const roomName of _.values<string>(mainIntel.getExits())) {
			const roomIntel = getRoomIntel(roomName);
			const roomMemory = Memory.rooms[roomName];
			if (roomMemory && roomMemory.enemies && !roomMemory.enemies.safe) continue;
			if (roomIntel.isClaimed()) continue;
			if (_.size(roomIntel.getStructures(STRUCTURE_KEEPER_LAIR)) > 0) continue;

			for (const source of roomIntel.getSourcePositions()) {
				const sourcePos = new RoomPosition(source.x, source.y, roomName);
				// @todo limit search to distance 1.
				const path = this.navMesh.findPath(creep.pos, sourcePos, {maxPathLength: 100});
				if (!path || path.incomplete) continue;

				possibleSources.push(sourcePos);
			}
		}

		this.chooseExtraEnergySource(creep, possibleSources);
	}

	chooseExtraEnergySource(creep: RemoteBuilderCreep, possibleSources: RoomPosition[]) {
		const targetPos = _.sample(possibleSources);
		if (targetPos) {
			creep.memory.extraEnergyTarget = encodePosition(targetPos);
			creep.memory.sourceRoom = creep.pos.roomName;
			delete creep.memory.singleRoom;
		}
	}

	/**
	 * Collects energy from extra energy sources from adjacent rooms.
	 */
	collectExtraEnergy() {
		if (this.creep.store.getFreeCapacity() === 0) {
			delete this.creep.memory.extraEnergyTarget;
			return;
		}

		const pos = decodePosition(this.creep.memory.extraEnergyTarget);
		if (this.creep.pos.getRangeTo(pos) > 1) {
			if (!this.creep.moveToRange(pos, 1)) {
				delete this.creep.memory.extraEnergyTarget;
			}

			return;
		}

		const source = this.creep.pos.findClosestByRange(FIND_SOURCES);
		this.creep.harvest(source);
		if (source.energy <= 0) {
			delete this.creep.memory.extraEnergyTarget;
		}
	}
}
