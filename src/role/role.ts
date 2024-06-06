/* global RoomPosition RIGHT LEFT TOP BOTTOM */

import {ENEMY_STRENGTH_NONE} from 'room-defense';
import {getDangerMatrix} from 'utils/cost-matrix';

declare global {
	interface CreepMemory {
		role?: string;
		singleRoom?: string;
	}

	interface CreepHeapMemory {
		suicideSpawn: Id<StructureSpawn>;
	}

	interface PowerCreepMemory {
		role: string;
		singleRoom?: string;
	}
}

export default class Role {
	throttleAt: number;
	stopAt: number;

	/**
	 * Base class for creep roles.
	 * @constructor
	 */
	constructor() {
		this.throttleAt = 8000;
		this.stopAt = 2000;
	}

	run(creep: Creep | PowerCreep) {
		throw new Error('Implementation missing.');
	}

	preRun(creep: Creep | PowerCreep): boolean {
		if (this.containSingleRoomCreep(creep)) return false;

		if (creep instanceof Creep && creep.room.boostManager?.overrideCreepLogic(creep)) {
			return false;
		}

		return true;
	}

	/**
	 * Ensures that creeps which are restricted to a single room stay there.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @return {boolean}
	 *   True if creep is busy getting back to its room.
	 */
	containSingleRoomCreep(creep: Creep | PowerCreep): boolean {
		if (!creep.memory.singleRoom) return false;

		if (creep.pos.roomName === creep.memory.singleRoom) {
			let stuck = true;
			if (creep.pos.x === 0) {
				creep.move(RIGHT);
			}
			else if (creep.pos.y === 0) {
				creep.move(BOTTOM);
			}
			else if (creep.pos.x === 49) {
				creep.move(LEFT);
			}
			else if (creep.pos.y === 49) {
				creep.move(TOP);
			}
			else {
				stuck = false;
			}

			if (stuck) {
				creep.say('unstuck!');
				delete creep.memory.go;
				creep.clearCachedPath();
				return true;
			}
		}
		else {
			creep.whenInRange(10, new RoomPosition(25, 25, creep.memory.singleRoom), () => {});
			return true;
		}

		return false;
	}

	performRecycle(creep: Creep) {
		// Return home and suicide.
		if (!creep.heapMemory.suicideSpawn) {
			const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
			creep.heapMemory.suicideSpawn = spawn?.id;

			if (!spawn) {
				creep.suicide();
				return;
			}
		}

		if (creep.heapMemory.suicideSpawn) {
			const spawn = Game.getObjectById(creep.heapMemory.suicideSpawn);
			if (spawn) {
				creep.whenInRange(1, spawn, () => {
					spawn.recycleCreep(creep);
				});
			}
			else {
				delete creep.heapMemory.suicideSpawn;
			}
		}
	}

	isSafePosition(creep: Creep | PowerCreep, pos: RoomPosition): boolean {
		if (!creep.room.isMine()) return true;
		if (creep.room.defense.getEnemyStrength() === ENEMY_STRENGTH_NONE) return true;

		const matrix = getDangerMatrix(creep.room.name);
		if (matrix.get(pos.x, pos.y) > 0) return false;

		return true;
	}
}
