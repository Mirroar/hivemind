import hivemind from 'hivemind';

declare global {
	interface RoomMemory {
		isReclaimableSince?: number;
	}
}

let lastReclaimCleanup = Game.time;

export default class ReclaimManager {
	public updateReclaimStatus(room: Room) {
		if (this.needsToReclaim(room)) {
			this.updateReclaimTimer(room);
			return;
		}

		if (this.hasJustFinishedReclaiming(room)) {
			delete room.memory.isReclaimableSince;
		}
	}

	private needsToReclaim(room: Room): boolean {
		if (Game.myRooms.length <= 1) return false;
		if (this.hasSpawn(room)) return false;
		if (this.isExpansionTarget(room)) return false;

		return true;
	}

	private hasSpawn(room: Room): boolean {
		return room.myStructuresByType[STRUCTURE_SPAWN].length > 0;
	}

	private isExpansionTarget(room: Room): boolean {
		if (!Memory.strategy) return false;
		if (!Memory.strategy.expand) return false;
		if (!Memory.strategy.expand.currentTarget) return false;

		return room.name === Memory.strategy.expand.currentTarget.roomName;
	}

	private updateReclaimTimer(room: Room) {
		if (!room.memory.isReclaimableSince) room.memory.isReclaimableSince = Game.time;

		// Reset reclaim timer if we have no defense in the room.
		if (room.myStructuresByType[STRUCTURE_TOWER].length > 0) return;
		if ((room.controller.safeMode ?? 0) > 5000) return;

		for (const username in room.enemyCreeps) {
			if (!hivemind.relations.isAlly(username)) {
				room.memory.isReclaimableSince = Game.time;
				break;
			}
		}
	}

	private hasJustFinishedReclaiming(room: Room): boolean {
		if (!room.memory.isReclaimableSince) return false;
		if (!room.roomManager) return false;
		if (!room.roomManager.checkWallIntegrity()) return false;
		if (!this.hasSpawn(room)) {
			return false;
		}

		if (room.myStructuresByType[STRUCTURE_TOWER].length === 0) {
			return false;
		}

		return true;
	}

	public cleanReclaimMemory() {
		if (!hivemind.hasIntervalPassed(1000, lastReclaimCleanup)) return;
		lastReclaimCleanup = Game.time;

		for (const roomName in Memory.rooms || {}) {
			if (Game.rooms[roomName] && Game.rooms[roomName].isMine()) continue;
			if (!Memory.rooms[roomName].isReclaimableSince) continue;

			delete Memory.rooms[roomName].isReclaimableSince;
		}
	}

	public roomNeedsReclaiming(room: Room): boolean {
		if (room.memory.isReclaimableSince) return true;

		return false;
	}

	public roomIsSafeForReclaiming(room: Room): boolean {
		if (!room.memory.isReclaimableSince) return false;

		return Game.time - room.memory.isReclaimableSince > 2000
			|| (room.controller?.safeMode ?? 0) > 2000;
	}
}
