/* global STRUCTURE_KEEPER_LAIR */
import RemotePathManager from 'empire/remote-path-manager';
import hivemind from 'hivemind';
import RoomStatus from 'room/room-status';
import settings from 'settings-manager';
import SquadManager from 'manager.squad';
import {getRoomIntel} from 'room-intel';
import {decodePosition, encodePosition} from 'utils/serialization';

interface SourceCandidateInfo {
	encodedSource: string;
	remoteRoomName: string;
	ownRoomName: string;
	pathLength: number;
}

type SourceRoomAvailability = {
	current: number;
	max: number;
};

export default class RemoteMinePrioritizer {
	constructor(
		private roomStatus: RoomStatus,
		private squadManager: SquadManager,
		private pathManager: RemotePathManager,
	) {}

	getRoomsToMine(maxAmount: number): {rooms: string[]; maxRooms: number} {
		const {sourceAssignments, maxSources} = this.getSourcesToMine(maxAmount);
		const rooms = [...new Set(Object.keys(sourceAssignments).map(k => decodePosition(k).roomName))];
		return {rooms, maxRooms: maxSources};
	}

	isMiningRoom(roomName: string): boolean {
		for (const encodedPosition in Memory.strategy.remoteHarvesting.sourceAssignments) {
			const position = decodePosition(encodedPosition);
			if (position.roomName === roomName) return true;
		}

		return false;
	}

	getSourceCandidates(sourceRooms: Record<string, SourceRoomAvailability>): SourceCandidateInfo[] {
		if (!hivemind.segmentMemory.isReady()) return [];

		const candidates: SourceCandidateInfo[] = [];
		for (const roomName of this.roomStatus.getAllKnownRooms()) {
			if (Game.rooms[roomName]?.isMine()) continue;
			if (Game.map.getRoomStatus(roomName).status === 'closed') continue;

			const roomIntel = getRoomIntel(roomName);
			const sourcePositions = roomIntel.getSourcePositions();
			if (sourcePositions.length === 0) continue;

			for (const sourceInfo of sourcePositions) {
				const sourcePos = new RoomPosition(sourceInfo.x, sourceInfo.y, roomName);

				for (const ownRoomName of Object.keys(sourceRooms)) {
					if (Game.map.getRoomLinearDistance(roomName, ownRoomName) > hivemind.settings.get('maxRemoteMineRoomDistance')) continue;

					const path = this.pathManager.getPathTo(sourcePos, ownRoomName);
					if (!path || path.length >= hivemind.settings.get('maxRemoteMinePathLength')) continue;

					candidates.push({
						encodedSource: encodePosition(sourcePos),
						remoteRoomName: roomName,
						ownRoomName,
						pathLength: path.length,
					});
				}
			}
		}

		return candidates;
	}

	getSourcesToMine(maxAmount: number): {sourceAssignments: Record<string, string>; maxSources: number} {
		const sourceAssignments: Record<string, string> = {};
		const sourceRooms = this.getRemoteMiningSourceRooms();
		const candidates = _.sortBy(this.getSourceCandidates(sourceRooms), c => c.pathLength);

		let totalAvailableSources = 0;
		let assignmentCount = 0;
		for (const candidate of candidates) {
			// Skip sources already assigned (from a closer own room earlier in the sorted list).
			if (sourceAssignments[candidate.encodedSource]) continue;
			// Skip if this own room is at capacity.
			if (sourceRooms[candidate.ownRoomName].current >= sourceRooms[candidate.ownRoomName].max) continue;

			// SK room check: need RCL 7+ to harvest.
			const roomIntel = getRoomIntel(candidate.remoteRoomName);
			if (
				roomIntel.isSourceKeeperRoom()
				&& _.size(roomIntel.getStructures(STRUCTURE_KEEPER_LAIR)) > 0
				&& (Game.rooms[candidate.ownRoomName]?.controller?.level || 0) < 7
			) continue;

			sourceRooms[candidate.ownRoomName].current++;
			totalAvailableSources++;

			if (assignmentCount < maxAmount) {
				// Disregard sources the user doesn't want harvested.
				const roomFilter = settings.get('remoteMineRoomFilter');
				if (roomFilter && !roomFilter(candidate.remoteRoomName)) continue;

				sourceAssignments[candidate.encodedSource] = candidate.ownRoomName;
				assignmentCount++;
			}
		}

		return {sourceAssignments, maxSources: totalAvailableSources};
	}

	getRemoteMiningSourceRooms(): Record<string, SourceRoomAvailability> {
		const sourceRooms: Record<string, SourceRoomAvailability> = {};

		// Determine how much remote mining each room can handle.
		for (const room of Game.myRooms) {
			let spawnCount = _.filter(Game.spawns, spawn => spawn.pos.roomName === room.name && spawn.isOperational()).length;
			if (spawnCount === 0) {
				if (room.controller.level < 7) {
					// It's possible we're only moving the room's only spawn to a different
					// location, or building the first spawn. Treat room as having one spawn
					// so we can resume mining when it has been (re-)built.
					spawnCount = 1;
				}
				else {
					continue;
				}
			}

			// @todo Actually calculate spawn usage for each.
			let spawnCapacity = spawnCount * 7;
			let roomNeeds = 0;
			if (room.controller.level >= 4) roomNeeds++;
			if (room.controller.level >= 6) roomNeeds++;
			roomNeeds += _.filter(this.squadManager.getAllSquads(), squad => squad.getSpawn() === room.name).length;

			// Increase spawn capacity if there's a power creep that can help.
			const powerCreep = _.find(Game.powerCreeps, creep => {
				if (!creep.shard) return false;
				if (creep.shard !== Game.shard.name) return false;
				if (creep.pos.roomName !== room.name) return false;

				return true;
			});
			if (powerCreep) {
				const operateSpawnLevel = (powerCreep.powers[PWR_OPERATE_SPAWN] || {}).level || 0;
				if (operateSpawnLevel > 0) spawnCapacity /= POWER_INFO[PWR_OPERATE_SPAWN].effect[operateSpawnLevel - 1];
			}

			sourceRooms[room.name] = {
				current: 0,
				max: Math.floor(spawnCapacity - roomNeeds),
			};
		}

		return sourceRooms;
	}

}
