import hivemind from 'hivemind';

declare global {
	interface RoomMemory {
		isReclaimableSince: number;
	}
}

let lastReclaimCleanup = Game.time;

export default class ReclaimManager {

	public updateReclaimStatus(room: Room) {
		if (this.needsReclaiming(room)) {
			this.updateReclaimTimer(room);
			return;
		}

		if (this.hasJustFinishedReclaiming(room)) {
			delete room.memory.isReclaimableSince;
		}
	}

	private needsReclaiming(room: Room): boolean {
		if (Game.myRooms.length <= 1) return false;
		if (this.hasSpawn(room)) return false;
		if (this.isExpansionTarget(room)) return false;

		return true;
	}

	private hasSpawn(room: Room): boolean {
		return room.find(FIND_MY_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_SPAWN
		}).length > 0;
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
		if (room.find(FIND_MY_STRUCTURES, {filter: s => s.structureType === STRUCTURE_TOWER}).length > 0) return;
		if (room.find(FIND_MY_CREEPS, {filter: c => c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0}).length > 0) return;
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

}
