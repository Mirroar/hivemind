/* global RoomPosition StructureController CLAIM
FIND_STRUCTURES STRUCTURE_SPAWN STRUCTURE_PORTAL
LOOK_STRUCTURES CREEP_LIFE_TIME */

import container from 'utils/container';
import MilitaryRole from 'role/military';
import type {MilitaryTargetOption} from 'role/military';
import SquadManager from 'manager.squad';
import {decodePosition} from 'utils/serialization';
import {getUsername} from 'utils/account';

declare global {
	interface SquadBrawlerCreep extends Creep {
		memory: SquadBrawlerCreepMemory;
		heapMemory: SquadBrawlerCreepHeapMemory;
	}

	interface SquadBrawlerCreepMemory extends MilitaryCreepMemory {
		role: 'squad-brawler';
		squadName: string;
		squadUnitType: SquadUnitType;
	}

	interface SquadBrawlerCreepHeapMemory extends MilitaryCreepHeapMemory {
	}
}

/**
 * Role for squad-based combat creeps.
 *
 * Handles creeps spawned as part of a military squad (expansion, intershard,
 * manual attack squads). These creeps get their orders from the squad and
 * coordinate movement through the squad system.
 */
export default class SquadBrawlerRole extends MilitaryRole {
	squadManager: SquadManager;

	constructor() {
		super();
		this.squadManager = container.get('SquadManager');
	}

	/**
	 * Makes a creep behave as a squad combat unit.
	 *
	 * @param {SquadBrawlerCreep} creep
	 *   The creep to run logic for.
	 */
	run(creep: SquadBrawlerCreep) {
		if (!creep.memory.initialized) {
			creep.memory.initialized = true;
		}

		// Target is recalculated every tick for best results.
		this.calculateMilitaryTarget(creep);

		this.performMilitaryMove(creep);

		if (creep.memory.order) {
			const target = Game.getObjectById<Creep | AnyStructure>(creep.memory.order.target);
			if (target instanceof StructureController && !target.my && this.handleControllerAction(creep, target)) return;
		}

		container.get('CombatManager').manageCombatActions(creep);
	}

	/**
	 * Called when no military targets are found.
	 * Recycles expansion claimers that have completed their mission.
	 */
	onNoTargets(creep: SquadBrawlerCreep, options: MilitaryTargetOption[]) {
		const squad = this.squadManager.getSquad(creep.memory.squadName);
		if (!squad || creep.pos.roomName !== squad.getTarget()?.roomName) return;
		if (options.length === 0 && creep.getActiveBodyparts(CLAIM) > 0 && creep.memory.squadName?.startsWith('expand')) {
			this.performRecycle(creep);
		}
	}

	/**
	 * Coordinates movement for squad combat creeps.
	 *
	 * @param {SquadBrawlerCreep} creep
	 *   The creep to run logic for.
	 */
	performMilitaryMove(creep: SquadBrawlerCreep) {
		this.performSquadMove(creep);

		// Don't move expansion squads through enemy rooms.
		const allowDanger = !creep.memory.squadName.startsWith('expand');

		if (creep.memory.target) {
			const targetPosition = decodePosition(creep.memory.target);
			if (this.performInterRoomTravel(creep, targetPosition, allowDanger)) return;
		}

		this.performInRoomBehavior(creep);
	}

	/**
	 * Handles in-room behaviour for squad creeps: engaging ordered targets,
	 * following squad positioning instructions, or falling back to idle movement.
	 *
	 * @param {SquadBrawlerCreep} creep
	 */
	performInRoomBehavior(creep: SquadBrawlerCreep) {
		if (creep.memory.order) {
			const target = Game.getObjectById(creep.memory.order.target);
			this.moveToEngageTarget(creep, target);
			return;
		}

		// This only gets called for squad units in a room where no fighting
		// needs to take place.
		const squad = this.squadManager.getSquad(creep.memory.squadName);
		const targetPos = squad && squad.getTarget();
		if (targetPos) {
			creep.whenInRange(this.isPositionBlocked(targetPos) ? 3 : 0, targetPos, () => {
				const structures = targetPos.lookFor(LOOK_STRUCTURES);
				if (_.some(structures, s => s.structureType === STRUCTURE_PORTAL)) {
					creep.move(creep.pos.getDirectionTo(targetPos));
				}
			});

			return;
		}

		this.performIdleMovement(creep);
	}

	/**
	 * Makes a creep move as part of a squad.
	 *
	 * Sets the creep's target based on squad orders and handles idle renewal
	 * at the spawn room when no orders are active.
	 *
	 * @param {SquadBrawlerCreep} creep
	 *   The creep to run logic for.
	 */
	performSquadMove(creep: SquadBrawlerCreep) {
		// Check if there are orders and set a target accordingly.
		const squad = this.squadManager.getSquad(creep.memory.squadName);
		if (!squad) return; // @todo Go recycle.

		// Movement is dictated by squad orders.
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

		// Refresh creep if it's getting low, so that it has high lifetime when a mission finally starts.
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
	 * Squad-specific controller interaction.
	 * Claims the controller if the squad target is directly on it,
	 * otherwise does nothing (unlike individual brawlers which reserve).
	 *
	 * @param {SquadBrawlerCreep} creep
	 *   The creep to run logic for.
	 * @param {StructureController} controller
	 *   The controller to interact with.
	 *
	 * @return {boolean}
	 *   True if an action was performed.
	 */
	handleControllerAction(creep: SquadBrawlerCreep, controller: StructureController): boolean {
		if (controller.owner && creep.attackController(controller) === OK) {
			return true;
		}

		// If attack flag is directly on controller, claim it.
		const squad = this.squadManager.getSquad(creep.memory.squadName);
		const targetPos = squad && squad.getTarget();
		if (targetPos && targetPos.getRangeTo(controller) === 0) {
			if (controller.reservation && controller.reservation.username !== getUsername()) {
				creep.attackController(controller);
				return true;
			}

			if (creep.claimController(controller) === OK) {
				return true;
			}
		}

		return false;
	}
}
