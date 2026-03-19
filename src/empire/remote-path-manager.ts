/* global PathFinder STRUCTURE_KEEPER_LAIR */

import cache from 'utils/cache';
import hivemind from 'hivemind';
import {encodePosition} from 'utils/serialization';
import {getRoomIntel} from 'room-intel';
import {handleMapArea} from 'utils/map';
import {packPosList, unpackPosList} from 'utils/packrat';

declare global {
	type RemotePathMemory = {
		generated: number;
		path: string | null;
	};
}

export default class RemotePathManager {
	getPathTo(sourcePosition: RoomPosition, targetRoomName: string): RoomPosition[] | null {
		if (!hivemind.segmentMemory.isReady()) return null;

		const hasStorageOrTerminal = !!(Game.rooms[targetRoomName]?.storage || Game.rooms[targetRoomName]?.terminal);
		const key = 'remotePath:' + encodePosition(sourcePosition) + ':' + targetRoomName + ':' + (hasStorageOrTerminal ? '1' : '0');
		if (!hivemind.segmentMemory.has(key)) {
			hivemind.segmentMemory.set(key, {});
		}

		const memory: RemotePathMemory = hivemind.segmentMemory.get(key);
		if (memory.generated && !hivemind.hasIntervalPassed(15000, memory.generated)) {
			if (!memory.path) return null;

			return unpackPosList(memory.path);
		}

		const room = Game.rooms[targetRoomName];
		if (!room?.roomPlanner) {
			// Return no path, but don't cache.
			return null;
		}

		const storagePos = room.roomPlanner.getLocations('storage')[0];
		if (!storagePos) {
			// Return no path, but don't cache.
			return null;
		}

		const result = PathFinder.search(sourcePosition, {pos: storagePos, range: 1}, {
			plainCost: 2,
			swampCost: (room.storage || room.terminal) ? 3 : 10,
			maxOps: 10_000, // The default 2000 can be too little even at a distance of only 2 rooms.
			roomCallback: roomName => this.getRemotePathCostMatrix(roomName, sourcePosition.roomName === roomName),
			heuristicWeight: 1,
		});

		if (!result || result.incomplete) {
			memory.generated = Game.time;
			memory.path = null;
			return null;
		}

		// @todo Register this path so we know which rooms it touches.
		memory.generated = Game.time;
		memory.path = packPosList(result.path);
		return result.path;
	}

	getPathFor(sourcePosition: RoomPosition): RoomPosition[] | null {
		if (!hivemind.segmentMemory.isReady()) return null;

		// If this source has an active assignment, return its path.
		const encoded = encodePosition(sourcePosition);
		const assigned = Memory.strategy?.remoteHarvesting?.sourceAssignments?.[encoded];
		if (assigned) return this.getPathTo(sourcePosition, assigned);

		// Otherwise find the shortest path to any eligible own room.
		const availableSourceRooms = _.filter(
			Game.myRooms,
			r => Game.map.getRoomLinearDistance(sourcePosition.roomName, r.name) <= hivemind.settings.get('maxRemoteMineRoomDistance'),
		);
		const sortedByDist = _.sortBy(availableSourceRooms, r => Game.map.getRoomLinearDistance(sourcePosition.roomName, r.name));

		let minPath: RoomPosition[] | null = null;
		let minPathLength: number = hivemind.settings.get('maxRemoteMinePathLength') + 50;
		for (const room of sortedByDist) {
			const cannotFindShorterPath = Game.map.getRoomLinearDistance(sourcePosition.roomName, room.name) > Math.ceil(minPathLength / 50);
			if (minPathLength < hivemind.settings.get('maxRemoteMinePathLength') && cannotFindShorterPath) continue;

			const path = this.getPathTo(sourcePosition, room.name);
			if (!path || path.length >= minPathLength) continue;

			minPath = path;
			minPathLength = path.length;
		}

		return minPath;
	}

	getRemotePathCostMatrix(roomName: string, isTargetRoom: boolean): CostMatrix | false {
		return cache.inHeap('remotePathManagerCostMatrix:' + roomName + (isTargetRoom ? ':t' : ''), 1000, () => {
			const roomIntel = getRoomIntel(roomName);

			// Don't path through rooms owned by other players.
			if (roomIntel.isOwned()) return false;

			// Initialize a cost matrix for this room.
			const isMyRoom = Game.rooms[roomName] && Game.rooms[roomName].isMine();
			const matrix = isMyRoom ? Game.rooms[roomName].roomPlanner.getNavigationMatrix().clone() : new PathFinder.CostMatrix();

			// @todo Set to 1 for each road used by _other_ active remote mining paths in this room.
			// This should lead to paths converging to reuse road sections where possible.
			// For now, we just use road locations from intel as a guide.
			const roads = roomIntel.getRoadCoords();
			for (const road of roads) {
				if (matrix.get(road.x, road.y) === 0) matrix.set(road.x, road.y, 1);
			}

			if (!isTargetRoom && _.size(roomIntel.getStructures(STRUCTURE_KEEPER_LAIR)) > 0) {
				// Disallow areas around source keeper sources.
				_.each(roomIntel.getSourcePositions(), sourceInfo => {
					handleMapArea(sourceInfo.x, sourceInfo.y, (x, y) => {
						matrix.set(x, y, 255);
					}, 4);
				});

				// Disallow areas around source keeper sources.
				const sourcePositions = roomIntel.getSourcePositions();
				for (const sourceInfo of sourcePositions) {
					handleMapArea(sourceInfo.x, sourceInfo.y, (x, y) => {
						matrix.set(x, y, 255);
					}, 4);
				}

				// Disallow areas around source keeper minerals.
				const mineralPositions = roomIntel.getMineralPositions();
				for (const mineralInfo of mineralPositions) {
					handleMapArea(mineralInfo.x, mineralInfo.y, (x, y) => {
						matrix.set(x, y, 255);
					}, 4);
				}
			}

			return matrix;
		});
	}
}
