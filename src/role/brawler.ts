/* global RoomPosition ATTACK RANGED_ATTACK HEAL
ERR_BUSY ERR_NOT_OWNER ERR_TIRED OK */

import container from 'utils/container';
import MilitaryRole from 'role/military';
import PathManager from 'empire/remote-path-manager';
import {decodePosition, serializePositionPath} from 'utils/serialization';

declare global {
	interface BrawlerCreep extends Creep {
		memory: BrawlerCreepMemory;
		heapMemory: BrawlerCreepHeapMemory;
	}

	interface BrawlerCreepMemory extends MilitaryCreepMemory {
		role: 'brawler';
		pathTarget?: string;
	}

	interface BrawlerCreepHeapMemory extends MilitaryCreepHeapMemory {
	}
}

/**
 * Role for individual (non-squad) combat creeps.
 *
 * Handles remote mine defense, low-level room defense, power harvest defense,
 * and reclaiming. These creeps are spawned by the `brawler` and `room-defense`
 * spawn roles and operate independently without squad coordination.
 */
export default class BrawlerRole extends MilitaryRole {
	/**
	 * Makes a creep behave like an individual combat defender.
	 *
	 * @param {BrawlerCreep} creep
	 *   The creep to run logic for.
	 */
	run(creep: BrawlerCreep) {
		if (!creep.memory.initialized) {
			this.initBrawlerState(creep);
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
	 * Initializes memory of individual combat creeps.
	 *
	 * @param {BrawlerCreep} creep
	 *   The creep to run logic for.
	 */
	initBrawlerState(creep: BrawlerCreep) {
		creep.memory.initialized = true;

		if (creep.memory.pathTarget) {
			// Reuse remote harvesting path.
			const pathManager = new PathManager();
			const path = pathManager.getPathFor(decodePosition(creep.memory.pathTarget));
			if (path) {
				creep.setCachedPath(serializePositionPath(path), true);
			}
		}
	}

	/**
	 * Coordinates movement for individual combat creeps.
	 *
	 * Handles creep trains, then inter-room travel, then in-room behavior.
	 * Individual defenders always allow travel through dangerous rooms.
	 *
	 * @param {BrawlerCreep} creep
	 *   The creep to run logic for.
	 */
	performMilitaryMove(creep: BrawlerCreep) {
		if (creep.isPartOfTrain() && this.performTrainMove(creep) !== OK) return;

		if (creep.memory.target) {
			const targetPosition = decodePosition(creep.memory.target);
			if (this.performInterRoomTravel(creep, targetPosition, true)) return;
		}

		this.performInRoomBehavior(creep);
	}

	/**
	 * Handles movement for creep trains (multi-creep linked formations).
	 *
	 * @param {BrawlerCreep} creep
	 *   The creep to run logic for.
	 *
	 * @return {number}
	 *   OK if the train head is ready to move normally,
	 *   ERR_BUSY if still assembling,
	 *   ERR_NOT_OWNER if this creep is not the head,
	 *   ERR_TIRED if any segment is fatigued.
	 */
	performTrainMove(creep: BrawlerCreep) {
		// @todo Implement joined room border traversal.

		if (!creep.isTrainFullySpawned()) {
			// @todo Refresh creep if spawning takes a long time.

			// Stay inside of spawn room.
			const roomCenter = new RoomPosition(25, 25, creep.pos.roomName);
			if (creep.pos.getRangeTo(roomCenter) > 20) {
				creep.whenInRange(20, roomCenter, () => {});
				return ERR_BUSY;
			}

			// Move randomly around the room to not block spawns or other creeps.
			const direction = (1 + Math.floor(Math.random() * 8)) as DirectionConstant;
			creep.move(direction);
			return ERR_BUSY;
		}

		// Only the train head will schedule movement intents. The other creeps will
		// move when the head moves. ERR_NOT_OWNER is used non-semantically here —
		// it signals to performMilitaryMove() that this creep should not act further.
		if (!creep.isTrainHead()) return ERR_NOT_OWNER;

		// Make sure train is joined.
		if (!creep.isTrainJoined()) {
			creep.joinTrain();
			return ERR_BUSY;
		}

		// If any segment is fatigued, we can't move, or only move adjacent to
		// next segment.
		const segments = creep.getTrainParts();
		for (const segment of segments) {
			if (segment.fatigue > 0) return ERR_TIRED;
		}

		// Head may move. Make sure all other parts follow.
		for (let i = 1; i < segments.length; i++) {
			if (segments[i].pos.roomName !== segments[i - 1].pos.roomName) {
				segments[i].moveToRange(segments[i - 1].pos, 1);
				continue;
			}

			segments[i].move(segments[i].pos.getDirectionTo(segments[i - 1].pos));
		}

		return OK;
	}
}
