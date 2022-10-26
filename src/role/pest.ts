/* global FIND_HOSTILE_CREEPS FIND_MY_STRUCTURES STRUCTURE_RAMPART */

import Role from 'role/role';

declare global {
	interface PestCreep extends Creep {
		memory: PestCreepMemory;
		heapMemory: PestCreepHeapMemory;
	}

	interface PestCreepMemory extends CreepMemory {
		role: 'pest';
	}

	interface PestCreepHeapMemory extends CreepHeapMemory {
	}
}

export default class PestRole extends Role {
	constructor() {
		super();

		// Pests have reasonably high priority so they can keep running away.
		this.stopAt = 1000;
		this.throttleAt = 2500;
	}

	/**
	 * Makes a creep behave like a pest (hehe).
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: PestCreep) {
		// Move to assigned target room.
		// @todo If enemies are nearby, evade or harass them.
		// @todo Try to avoid conflict with non-enemy military creeps.
		const targetPosition = new RoomPosition(25, 25, creep.memory.targetRoom);
		if (creep.interRoomTravel(targetPosition)) return;

		// @todo Leave room if defenders show up (that we can not kite reliably).
		// Instead, choose a new target room nearby, or go scouting, or camp outside for a few hundred ticks.

		// @todo Attack harvest / transport creeps, ideally those with energy in them.
		// @todo Attack containers
		// @todo Attack roads and other infrastructure
	}
}
