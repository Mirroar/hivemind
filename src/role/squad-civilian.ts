/* global RoomPosition CREEP_LIFE_TIME FIND_STRUCTURES STRUCTURE_SPAWN */

import container from 'utils/container';
import Role from 'role/role';
import SquadCivilianEscort from 'role/squad-civilian-escort';
import TransporterRole from 'role/transporter';
import {decodePosition} from 'utils/serialization';
import SquadManager from 'manager.squad';

declare global {
	interface SquadCivilianCreep extends Creep {
		memory: SquadCivilianCreepMemory;
		heapMemory: SquadCivilianCreepHeapMemory;
	}

	interface SquadCivilianCreepMemory extends CreepMemory {
		role: 'squad-civilian';
		initialized?: boolean;
		squadName: string;
		squadUnitType: SquadUnitType;
		fillWithEnergy?: boolean;
		target?: string;
	}

	interface SquadCivilianCreepHeapMemory extends CreepHeapMemory {
	}
}

export default class SquadCivilianRole extends Role {
	transporterRole: TransporterRole;
	squadManager: SquadManager;
	squadCivilianEscort: SquadCivilianEscort;

	constructor() {
		super();

		// Squad civilians are always fully active while in transit.
		this.stopAt = 0;
		this.throttleAt = 0;

		this.transporterRole = new TransporterRole();
		this.squadManager = container.get('SquadManager');
		this.squadCivilianEscort = new SquadCivilianEscort();
	}

	/**
	 * Makes a creep behave as a squad civilian escort.
	 *
	 * These creeps travel under squad protection to a target room, then
	 * convert to their intended civilian role (harvester, builder, etc.).
	 *
	 * @param {SquadCivilianCreep} creep
	 *   The creep to run logic for.
	 */
	run(creep: SquadCivilianCreep) {
		if (!creep.memory.initialized) {
			this.initialize(creep);
		}

		if (this.performEnergyFilling(creep)) return;

		this.performSquadMove(creep);

		if (creep.memory.target) {
			const targetPosition = decodePosition(creep.memory.target);
			if (targetPosition && creep.pos.roomName === targetPosition.roomName) {
				this.squadCivilianEscort.attemptCivilianConversion(creep);
				return;
			}

			// Civilian creeps never travel through dangerous rooms.
			if (creep.interRoomTravel(targetPosition, false)) return;
		}

		this.performIdleMovement(creep);
	}

	/**
	 * Initializes memory of newly spawned civilian squad creeps.
	 *
	 * @param {SquadCivilianCreep} creep
	 *   The creep to initialize.
	 */
	initialize(creep: SquadCivilianCreep) {
		creep.memory.initialized = true;

		if (!creep.memory.squadCivilianSpecialization) {
			creep.memory.fillWithEnergy = true;
		}
	}

	/**
	 * Handles energy filling for squad civilian units before they depart.
	 *
	 * @param {SquadCivilianCreep} creep
	 *   The creep to run logic for.
	 * @return {boolean}
	 *   True if the creep is busy filling energy and should stop.
	 */
	performEnergyFilling(creep: SquadCivilianCreep): boolean {
		if (!creep.memory.fillWithEnergy) return false;

		if (creep.room.isMine() && creep.store.getFreeCapacity() > 0) {
			if (creep.room.getEffectiveAvailableEnergy() < 3000) {
				creep.whenInRange(5, new RoomPosition(25, 25, creep.room.name), () => {});
				return true;
			}

			this.transporterRole.performGetEnergy(creep as unknown as TransporterCreep);
			return true;
		}

		delete creep.memory.fillWithEnergy;
		return false;
	}

	/**
	 * Sets the creep's target from squad orders, or idles near spawn if no
	 * orders have been given. Handles creep renewal while waiting.
	 *
	 * @param {SquadCivilianCreep} creep
	 *   The creep to run logic for.
	 */
	performSquadMove(creep: SquadCivilianCreep) {
		const squad = this.squadManager.getSquad(creep.memory.squadName);
		if (!squad) return;

		const orders = squad.getOrders();
		if (orders.length > 0) {
			creep.memory.target = orders[0].target;
		}
		else {
			delete creep.memory.target;
		}

		if (creep.memory.target) return;

		// If no order has been given, wait by spawn and renew.
		const spawnRoom = squad.getSpawn();
		if (!spawnRoom || creep.pos.roomName !== spawnRoom) return;

		// Refresh creep if it's getting low, so that it has high lifetime when
		// a mission finally starts.
		if (creep.ticksToLive < CREEP_LIFE_TIME * 0.66) {
			const spawn = creep.pos.findClosestByRange<StructureSpawn>(FIND_STRUCTURES, {
				filter: structure => structure.structureType === STRUCTURE_SPAWN,
			});

			if (spawn) {
				creep.whenInRange(1, spawn, () => {
					spawn.renewCreep(creep);
				});
				return;
			}
		}

		// If there's nothing to do, move back to spawn room center.
		creep.whenInRange(5, new RoomPosition(25, 25, creep.pos.roomName), () => {});
	}

	/**
	 * Falls back to idle movement toward the squad's target position
	 * when no inter-room travel is needed.
	 *
	 * @param {SquadCivilianCreep} creep
	 *   The creep to run logic for.
	 */
	performIdleMovement(creep: SquadCivilianCreep) {
		if (creep.memory.squadName) {
			const squad = this.squadManager.getSquad(creep.memory.squadName);
			const targetPos = squad && squad.getTarget();
			if (targetPos) {
				creep.whenInRange(3, targetPos, () => {});
				return;
			}
		}

		creep.whenInRange(10, new RoomPosition(25, 25, creep.pos.roomName), () => {});
	}
}
