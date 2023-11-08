/* global RoomPosition FIND_SOURCES FIND_STRUCTURES STRUCTURE_SPAWN
FIND_MY_STRUCTURES RESOURCE_ENERGY ERR_NOT_IN_RANGE STRUCTURE_RAMPART
FIND_MY_CONSTRUCTION_SITES STRUCTURE_TOWER FIND_DROPPED_RESOURCES
STRUCTURE_CONTAINER FIND_SOURCES_ACTIVE */

import hivemind from 'hivemind';
import NavMesh from 'utils/nav-mesh';
import Role from 'role/role';
import TransporterRole from 'role/transporter';
import {encodePosition, decodePosition} from 'utils/serialization';
import {getRoomIntel} from 'room-intel';

declare global {
	interface RemoteBuilderCreep extends Creep {
		memory: RemoteBuilderCreepMemory;
		heapMemory: RemoteBuilderCreepHeapMemory;
	}

	interface RemoteBuilderCreepMemory extends CreepMemory {
		role: 'builder.remote';
		targetRoom?: string;
		interShardPortal?: string;
	}

	interface RemoteBuilderCreepHeapMemory extends CreepHeapMemory {
		repairMinHits?: number;
	}
}

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

		if (creep.memory.interShardPortal) {
			const targetPos = decodePosition(creep.memory.interShardPortal);
			if (creep.interRoomTravel(targetPos, true)) return;

			creep.whenInRange(1, targetPos, () => creep.moveTo(targetPos));
			return;
		}

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
				creep.moveToRoom(creep.memory.sourceRoom, true);
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
	setBuilderState(building: boolean) {
		this.creep.memory.building = building;
		delete this.creep.memory.buildTarget;
		delete this.creep.memory.repairTarget;
		delete this.creep.memory.resourceTarget;
		delete this.creep.memory.upgrading;
		delete this.creep.heapMemory.repairMinHits;
	}

	/**
	 * Spends energy in target room by building, repairing or upgrading.
	 */
	performRemoteBuild() {
		const creep: Creep = this.creep;

		// Try and prevent controller downgrades.
		if (creep.room.isMine() && !creep.room.controller.upgradeBlocked && (creep.room.controller.level < 2 || creep.room.controller.ticksToDowngrade < 500)) {
			creep.memory.upgrading = true;
			return;
		}

		// Recovering rooms need some RCL for defense.
		if (creep.room.isMine() && !creep.room.controller.upgradeBlocked && creep.room.needsReclaiming() && creep.room.controller.level < 4) {
			creep.memory.upgrading = true;
			return;
		}

		// Restore downgraded controllers.
		if (creep.room.isMine() && !creep.room.controller.upgradeBlocked && creep.room.controller.progress > creep.room.controller.progressTotal && !creep.room.controller.upgradeBlocked) {
			const upgrading = _.size(creep.room.creepsByRole.upgrader)
				+ _.size(_.filter(creep.room.creepsByRole['builder.remote'], creep => creep.memory.upgrading));

			if (upgrading === 0) {
				creep.memory.upgrading = true;
				return;
			}
		}

		// Help by filling spawn with energy.
		const spawns = _.filter(
			creep.room.structuresByType[STRUCTURE_SPAWN],
			structure =>
				structure.store[RESOURCE_ENERGY] < structure.store.getCapacity(RESOURCE_ENERGY) * 0.8
				&& (structure.my || hivemind.relations.isAlly(structure.owner.username)),
		);

		if (spawns && spawns.length > 0) {
			const maySwitchToRefill = (!creep.memory.repairTarget && !creep.memory.buildTarget) || creep.pos.getRangeTo(spawns[0].pos) < 5;
			if (maySwitchToRefill) {
				creep.whenInRange(1, spawns[0], () => creep.transfer(spawns[0], RESOURCE_ENERGY));
				return;
			}
		}

		if (this.supplyTowers()) return;

		let target = Game.getObjectById<ConstructionSite>(creep.memory.buildTarget);
		if ((!target || (target.structureType !== STRUCTURE_SPAWN && target.structureType !== STRUCTURE_TOWER)) && this.saveExpiringRamparts(10_000)) return;

		if (!creep.memory.buildTarget) {
			this.determineBuildTarget();

			if (!creep.memory.buildTarget && !creep.memory.repairTarget) {
				if (this.creep.room.needsReclaiming() && this.saveExpiringRamparts(hivemind.settings.get('minWallIntegrity'))) return;

				// Could not set a target for building. Start upgrading instead.
				if (creep.room.isMine()) {
					creep.memory.upgrading = true;
				}
			}
		}

		target = Game.getObjectById<ConstructionSite>(creep.memory.buildTarget);
		if (target) {
			creep.whenInRange(3, target, () => creep.build(target));
			return;
		}

		// If build target is gone, find a new one next tick.
		delete creep.memory.buildTarget;
	}

	supplyTowers() {
		const towers = _.filter(
			this.creep.room.structuresByType[STRUCTURE_TOWER],
			structure =>
				structure.store.getFreeCapacity(RESOURCE_ENERGY) > structure.store.getCapacity(RESOURCE_ENERGY) * 0.5
				&& (structure.my || hivemind.relations.isAlly(structure.owner.username)),
		);
		if (towers && towers.length > 0) {
			this.creep.whenInRange(1, towers[0], () => this.creep.transfer(towers[0], RESOURCE_ENERGY));
			return true;
		}

		return false;
	}

	/**
	 * Repairs ramparts that are low on hits, so they don't decay.
	 *
	 * @return {boolean}
	 *   True if we're trying to repair ramparts.
	 */
	saveExpiringRamparts(minHits: number): boolean {
		if (!this.creep.memory.repairTarget) {
			// Make sure ramparts don't break.
			const ramparts = _.filter(
				this.creep.room.structuresByType[STRUCTURE_RAMPART],
				structure =>
					structure.hits < Math.min(minHits, structure.hitsMax)
					&& (structure.my || hivemind.relations.isAlly(structure.owner.username)),
			);
			const spawns = _.filter(
				this.creep.room.structuresByType[STRUCTURE_SPAWN],
				structure =>
					structure.hits < structure.hitsMax
					&& (structure.my || hivemind.relations.isAlly(structure.owner.username)),
			);
			const towers = _.filter(
				this.creep.room.structuresByType[STRUCTURE_TOWER],
				structure =>
					structure.hits < structure.hitsMax
					&& (structure.my || hivemind.relations.isAlly(structure.owner.username)),
			);
			const targets = [...ramparts, ...spawns, ...towers]
			if (targets.length > 0) {
				this.creep.memory.repairTarget = targets[0].id;
				this.creep.heapMemory.repairMinHits = minHits;
			}
		}

		if (this.creep.memory.repairTarget) {
			let maxRampartHits = Math.max(
				minHits * 1.1,
				this.creep.room.controller.level < 6 ? 15_000 : hivemind.settings.get('minWallIntegrity') * 1.1,
				(this.creep.heapMemory.repairMinHits || 0) * 1.1,
			);
			if ((this.creep.room.controller.safeMode ?? 0) > 5000) maxRampartHits = 15_000;

			const target = Game.getObjectById<Structure>(this.creep.memory.repairTarget);
			if (!target || (target.structureType === STRUCTURE_RAMPART && target.hits > maxRampartHits)) {
				delete this.creep.memory.repairTarget;
				delete this.creep.heapMemory.repairMinHits;
			}

			this.creep.whenInRange(3, target, () => this.creep.repair(target));
			return true;
		}

		return false;
	}

	determineBuildTarget() {
		// Build structures.
		const targets = this.creep.room.find(FIND_CONSTRUCTION_SITES, {
			filter: site => site.my || hivemind.relations.isAlly(site.owner.username),
		});

		// Build towers before building anything else.
		const towerSites = _.filter(targets, structure => structure.structureType === STRUCTURE_TOWER);
		if (towerSites.length > 0) {
			this.creep.memory.buildTarget = towerSites[0].id;
			return;
		}

		// Build spawns with increased priority.
		const spawnSites = _.filter(targets, structure => structure.structureType === STRUCTURE_SPAWN);
		if (spawnSites.length > 0) {
			this.creep.memory.buildTarget = spawnSites[0].id;
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
			const lowRamparts = _.filter(
				this.creep.room.structuresByType[STRUCTURE_RAMPART],
				structure =>
					structure.hits < hivemind.settings.get('minWallIntegrity')
					&& (structure.my || hivemind.relations.isAlly(structure.owner.username)),
			);

			if (lowRamparts.length > 0) {
				this.creep.memory.repairTarget = _.min(lowRamparts, 'hits').id;
			}
		}
	}

	/**
	 * Upgrades the room's controller.
	 */
	performControllerUpgrade() {
		if (this.creep.room.controller.level === 0 || !this.creep.room.isMine() || this.creep.room.controller.upgradeBlocked) {
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

		const deliveringCreeps = creep.room.getCreepsWithOrder('workerCreep', creep.id);
		if (deliveringCreeps.length > 0) {
			creep.moveToRange(deliveringCreeps[0], 1);
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
			if (container && (creep.room.isMine() || !creep.room.controller.safeMode)) {
				creep.whenInRange(1, container, () => creep.withdraw(container, RESOURCE_ENERGY));
				return;
			}

			// Try get energy from a source.
			const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
			if (source && creep.room.isMine()) {
				creep.memory.resourceTarget = source.id;
			}
			else {
				// Or even get energy from adjacent rooms if marked.
				this.setExtraEnergyTarget(creep);

				// @todo Instead of completely circumventing TypeScript, find a way to
				// make energy gathering reusable between multiple roles.
				this.transporterRole.performGetEnergy(creep as unknown as TransporterCreep);
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
		else if (result === ERR_NOT_OWNER) {
			creep.memory.resourceTarget = null;
			this.setExtraEnergyTarget(creep);
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

		const dropped = this.creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
			filter: drop => drop.resourceType === RESOURCE_ENERGY && (drop.amount > this.creep.store.getCapacity() * 0.3 || (this.creep.pos.getRangeTo(drop) <= 1 && drop.amount > 20)),
		});
		if (dropped) {
			this.creep.whenInRange(1, dropped, () => this.creep.pickup(dropped));
			return;
		}

		// Try getting energy from full containers.
		const container = this.creep.pos.findClosestByPath(FIND_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_CONTAINER && (structure.store.energy || 0) > 500,
		});
		if (container && (this.creep.room.isMine() || !this.creep.room.controller.safeMode)) {
			this.creep.whenInRange(1, container, () => this.creep.withdraw(container, RESOURCE_ENERGY));
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
