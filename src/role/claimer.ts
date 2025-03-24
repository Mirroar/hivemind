import container from 'utils/container';
import CombatManager from 'creep/combat-manager';
import RemoteMiningOperation from 'operation/remote-mining';
import Role from 'role/role';
import {decodePosition} from 'utils/serialization';
import {getUsername} from 'utils/account';
import hivemind from 'hivemind';

declare global {
	interface RoomMemory {
		lastClaim?: {
			time: number;
			value: number;
		};
	}

	interface ClaimerCreep extends Creep {
		memory: ClaimerCreepMemory;
		heapMemory: ClaimerCreepHeapMemory;
		operation?: RemoteMiningOperation;
	}

	interface ClaimerCreepMemory extends CreepMemory {
		role: 'claimer';
		mission: 'claim' | 'reserve';
		target: string;
	}

	interface ClaimerCreepHeapMemory extends CreepHeapMemory {
	}
}

export default class ClaimerRole extends Role {
	private combatManager: CombatManager;

	constructor() {
		super();

		this.combatManager = container.get('CombatManager');

		// Claimers have high priority because of their short life spans.
		this.stopAt = 0;
		this.throttleAt = 0;
	}

	/**
	 * Makes a creep behave like a claimer.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: ClaimerCreep) {
		const targetPosition = decodePosition(creep.memory.target);
		if (this.combatManager.needsToFlee(creep)) {
			this.combatManager.performFleeTowards(creep, targetPosition, 1);
			return;
		}

		if (creep.interRoomTravel(targetPosition)) return;
		if (creep.pos.roomName !== targetPosition.roomName) return;

		if (creep.memory.mission === 'reserve') {
			this.performReserve(creep);
		}
		else if (creep.memory.mission === 'claim') {
			this.performClaim(creep);
		}
	}

	/**
	 * Makes the creep claim a room for the hive!
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performClaim(creep: ClaimerCreep) {
		const target = creep.room.controller;
		if (target.my) return;

		creep.whenInRange(1, target, () => {
			if (target.owner || (target.reservation && target.reservation.username !== getUsername())) {
				creep.attackController(target);
				return;
			}

			// @todo Use intershard info for determining number of rooms available.
			const roomCount = Game.myRooms.length;
			const maxRooms = Game.gcl.level;

			if (roomCount < maxRooms) {
				creep.claimController(target);
			}
			else {
				creep.reserveController(target);
			}
		});
	}

	/**
	 * Makes the creep reserve a room.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performReserve(creep: ClaimerCreep) {
		const target = creep.room.controller;

		creep.whenInRange(1, target, () => {
			let reservation = 0;
			if (creep.room.controller.reservation && creep.room.controller.reservation.username === getUsername()) {
				reservation = creep.room.controller.reservation.ticksToEnd;
			}

			creep.room.memory.lastClaim = {
				time: Game.time,
				value: reservation,
			};

			if (creep.room.controller.reservation && creep.room.controller.reservation.username !== getUsername()) {
				if (!hivemind.relations.isAlly(creep.room.controller.reservation.username)) {
					creep.attackController(target);
				}
				return;
			}

			creep.reserveController(target);

			if (target.sign?.username) {
				creep.signController(target, '');
			}
		});
	}
}
