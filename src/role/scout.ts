/* global RoomPosition OK */

import cache from 'utils/cache';

import Role from 'role/role';
import {encodePosition, decodePosition} from 'utils/serialization';
import {getRoomIntel} from 'room-intel';

declare global {
	interface ScoutCreep extends Creep {
		memory: ScoutCreepMemory;
		heapMemory: ScoutCreepHeapMemory;
	}

	interface ScoutCreepMemory extends CreepMemory {
		role: 'scout';
		scoutTarget?: string;
		portalTarget?: string;
		invalidScoutTargets?: string[];
	}

	interface ScoutCreepHeapMemory extends CreepHeapMemory {
		moveWithoutNavMesh?: boolean;
		roomHistory: string[];
		posHistory: string[];
		lastPos: string;
		stuckCount: number;
		pauseUntil?: number;
	}
}

const accessibilityCache = {};

export default class ScoutRole extends Role {
	/**
	 * Makes a creep behave like a scout.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: ScoutCreep) {
		if (creep.memory.disableNotifications) {
			// No attack notifications for scouts, please.
			creep.notifyWhenAttacked(false);
			delete creep.memory.disableNotifications;
		}

		if (!creep.memory.scoutTarget && !creep.memory.portalTarget) {
			this.chooseScoutTarget(creep);
		}

		this.performScout(creep);
	}

	/**
	 * Makes this creep move between rooms to gather intel.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performScout(creep: ScoutCreep) {
		if (creep.memory.portalTarget) {
			const portalPosition = decodePosition(creep.memory.portalTarget);
			if (creep.pos.roomName === portalPosition.roomName) {
				if (creep.pos.getRangeTo(portalPosition) > 1) {
					creep.moveToRange(portalPosition, 1);
				}
				else {
					creep.moveTo(portalPosition);
				}
			}
			else {
				creep.moveToRoom(portalPosition.roomName);
			}

			return;
		}

		if (!creep.memory.scoutTarget) {
			// Just stand around somewhere.
			const target = new RoomPosition(25, 25, creep.pos.roomName);
			if (creep.pos.getRangeTo(target) > 3) {
				creep.moveToRange(target, 3);
			}

			return;
		}

		if (typeof creep.room.visual !== 'undefined') {
			creep.room.visual.text(creep.memory.scoutTarget, creep.pos);
		}

		if (this.isOscillating(creep) || this.isStuck(creep)) this.chooseScoutTarget(creep, true);

		if (!creep.memory.scoutTarget) {
			// Just stand around somewhere.
			const target = new RoomPosition(25, 25, creep.pos.roomName);
			if (creep.pos.getRangeTo(target) > 3) {
				creep.moveToRange(target, 3);
			}

			return;
		}

		const targetPosition = new RoomPosition(25, 25, creep.memory.scoutTarget);
		if (creep.interRoomTravel(targetPosition)) return;

		this.chooseScoutTarget(creep);
	}

	/**
	 * Chooses which of the possible scout target rooms to travel to.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {boolean} invalidateOldTarget
	 *   If true, the old scout target is deemed invalid and will no longer be
	 *   scouted by this creep.
	 */
	chooseScoutTarget(creep: ScoutCreep, invalidateOldTarget?: boolean) {
		if (creep.heapMemory.pauseUntil) {
			if (Game.time >= creep.heapMemory.pauseUntil) delete creep.heapMemory.pauseUntil;
			return;
		}

		if (creep.memory.scoutTarget && invalidateOldTarget) {
			if (!creep.memory.invalidScoutTargets) {
				creep.memory.invalidScoutTargets = [];
			}

			creep.memory.invalidScoutTargets.push(creep.memory.scoutTarget);
		}

		delete creep.memory.scoutTarget;
		delete creep.heapMemory.moveWithoutNavMesh;
		if (!creep.memory.origin) creep.memory.origin = creep.room.name;
		if (!Memory.strategy) return;
		if (!hivemind.segmentMemory.isReady()) return;

		const best = this.getBestScoutOption(creep);

		if (best) {
			creep.memory.scoutTarget = best.info.roomName;
			const roomIntel = getRoomIntel(best.info.roomName);
			roomIntel.registerScoutAttempt();
		}

		if (!creep.memory.scoutTarget) {
			creep.memory.scoutTarget = creep.memory.origin;
			creep.heapMemory.pauseUntil = Game.time + 50;
		}
	}

	getBestScoutOption(creep: ScoutCreep) {
		const candidates = _.sortByAll(
			this.getScoutableRoomsForCreep(creep),
			info => -info.scoutPriority,
			info => {
				const roomIntel = getRoomIntel(info.roomName);
				return roomIntel.getLastScoutAttempt() - info.range * 50;
			},
		);

		for (const info of candidates) {
			if (!this.hasRoomPath(creep, info.roomName)) continue;

			const roomIntel = getRoomIntel(info.roomName);
			const lastScout = roomIntel.getLastScoutAttempt();
			return {info, lastScout};
		}

		return null;
	}

	getScoutableRoomsForCreep(creep: ScoutCreep) {
		return _.filter<any>(this.getScoutableRoomsByOrigin(creep.memory.origin), info => {
			if (info.roomName === creep.pos.roomName) return false;
			if (creep.memory.invalidScoutTargets && creep.memory.invalidScoutTargets.includes(info.roomName)) return false;

			return true;
		});
	}

	getScoutableRoomsByOrigin(origin: string) {
		return cache.inHeap('scoutableRooms:' + origin, 200, () => _.filter<any>(this.getScoutableRooms(), info => {
			if (info.origin !== origin) return false;

			return true;
		}));
	}

	getScoutableRooms() {
		return cache.inHeap('scoutableRooms', 200, () => _.filter<any>(Memory.strategy.roomList, info => {
			if (!info.roomName) return false;
			if (info.scoutPriority <= 0) return false;

			return true;
		}));
	}

	hasRoomPath(creep: Creep, destination: string): boolean {
		return cache.inObject(accessibilityCache, creep.pos.roomName + '/' + destination, 5000, () => {
			const path = creep.calculateRoomPath(destination, true);
			if (path) return true;

			return false;
		});
	}

	isOscillating(creep: ScoutCreep) {
		if (!creep.heapMemory.roomHistory) creep.heapMemory.roomHistory = [];
		const history = creep.heapMemory.roomHistory;

		if (history.length === 0 || history[history.length - 1] !== creep.pos.roomName) history.push(creep.pos.roomName);
		if (history.length > 20) creep.heapMemory.roomHistory = history.slice(-10);

		if (
			history.length >= 10 &&
			history[history.length - 1] === history[history.length - 3] &&
			history[history.length - 2] === history[history.length - 4] &&
			history[history.length - 3] === history[history.length - 5] &&
			history[history.length - 4] === history[history.length - 6] &&
			history[history.length - 5] === history[history.length - 7] &&
			history[history.length - 6] === history[history.length - 8] &&
			history[history.length - 7] === history[history.length - 9] &&
			history[history.length - 8] === history[history.length - 10]
		) {
			delete creep.heapMemory.roomHistory;
			return true;
		}

		return this.isTileOscillating(creep);
	}

	isTileOscillating(creep: ScoutCreep) {
		if (!creep.heapMemory.posHistory) creep.heapMemory.posHistory = [];
		const history = creep.heapMemory.posHistory;
		const pos = encodePosition(creep.pos);

		if (history.length === 0 || history[history.length - 1] !== pos) history.push(pos);
		if (history.length > 30) creep.heapMemory.posHistory = history.slice(-20);
		if (_.filter(history, v => v === pos).length >= 5) {
			delete creep.heapMemory.posHistory;
			return true;
		}

		return false;
	}

	isStuck(creep: ScoutCreep) {
		const pos = encodePosition(creep.pos);

		if (!creep.heapMemory.lastPos || creep.heapMemory.lastPos !== pos) {
			creep.heapMemory.lastPos = pos;
			creep.heapMemory.stuckCount = 1;
			return false;
		}

		if (creep.heapMemory.stuckCount++ < 10) return false;

		return true;
	}
}
