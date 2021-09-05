/* global OK */

declare global {
	interface ClaimerCreep extends Creep {
		memory: ClaimerCreepMemory,
		heapMemory: ClaimerCreepHeapMemory,
	}

	interface ClaimerCreepMemory extends CreepMemory {
		role: 'claimer',
		mission: 'claim' | 'reserve',
		target: string,
	}

	interface ClaimerCreepHeapMemory extends CreepHeapMemory {
	}
}

import hivemind from 'hivemind';
import utilities from 'utilities';
import Role from 'role/role';

export default class ClaimerRole extends Role {
	constructor() {
		super();

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
		if (this.moveToTargetRoom(creep)) return;

		if (creep.memory.mission === 'reserve') {
			this.performReserve(creep);
		}
		else if (creep.memory.mission === 'claim') {
			this.performClaim(creep);
		}
	}

	/**
	 * Moves the creep to the target room for its order.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @return {boolean}
	 *   True if the creep is still busy moving towards the target room.
	 */
	moveToTargetRoom(creep: ClaimerCreep) {
		const targetPosition = utilities.decodePosition(creep.memory.target);
		const isInTargetRoom = creep.pos.roomName === targetPosition.roomName;
		if (!isInTargetRoom || (!creep.isInRoom() && creep.getNavMeshMoveTarget())) {
			if (creep.moveUsingNavMesh(targetPosition) !== OK) {
				hivemind.log('creeps').debug(creep.name, 'can\'t move from', creep.pos.roomName, 'to', targetPosition.roomName);
				// @todo This is cross-room movement and should therefore only calculate a path once.
				creep.moveToRange(targetPosition, 3);
			}

			return true;
		}

		creep.stopNavMeshMove();

		return false;
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
			if (target.owner || (target.reservation && target.reservation.username !== utilities.getUsername())) {
				creep.attackController(target);
				return;
			}

			// @todo Use intershard info for determining number of rooms available.
			const numRooms = _.size(_.filter(Game.rooms, room => room.isMine()));
			const maxRooms = Game.gcl.level;

			if (numRooms < maxRooms) {
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
			if (creep.room.controller.reservation && creep.room.controller.reservation.username !== utilities.getUsername()) {
				creep.attackController(target);
				return;
			}

			const result = creep.reserveController(target);
			if (result === OK) {
				let reservation = 0;
				if (creep.room.controller.reservation && creep.room.controller.reservation.username === utilities.getUsername()) {
					reservation = creep.room.controller.reservation.ticksToEnd;
				}

				creep.room.memory.lastClaim = {
					time: Game.time,
					value: reservation,
				};
			}

			if (target.sign && target.sign.username) {
				creep.signController(target, '');
			}
		});
	}
}
