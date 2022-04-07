/* global FIND_HOSTILE_CREEPS FIND_MY_STRUCTURES STRUCTURE_RAMPART */

declare global {
	interface PestCreep extends Creep {
		memory: PestCreepMemory,
		heapMemory: PestCreepHeapMemory,
	}

	interface PestCreepMemory extends CreepMemory {
		role: 'pest',
	}

	interface PestCreepHeapMemory extends CreepHeapMemory {
	}
}

import hivemind from 'hivemind';
import Role from 'role/role';

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
		const targetPosition = new RoomPosition(25, 25, creep.memory.targetRoom);
		if (creep.interRoomTravel(targetPosition)) return;
	}
};
