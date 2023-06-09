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
		path: string;
	};
}

export default class RemotePathManager {
	getPathFor(sourcePosition) {
		if (!hivemind.segmentMemory.isReady()) return;

		const key = 'remotePath:' + encodePosition(sourcePosition);
		if (!hivemind.segmentMemory.has(key)) {
			hivemind.segmentMemory.set(key, {});
		}

		const memory: RemotePathMemory = hivemind.segmentMemory.get(key);
		if (memory.generated && !hivemind.hasIntervalPassed(5000, memory.generated)) {
			if (!memory.path) return null;

			return unpackPosList(memory.path);
		}

		const availableSourceRooms = _.filter(Game.myRooms, r => Game.map.getRoomLinearDistance(sourcePosition.roomName, r.name) <= hivemind.settings.get('maxRemoteMineRoomDistance'));
		const sortedByDist = _.sortBy(availableSourceRooms, r => Game.map.getRoomLinearDistance(sourcePosition.roomName, r.name));

		let minPath;
		let minPathLength = hivemind.settings.get('maxRemoteMinePathLength') + 50;
		for (const room of sortedByDist) {
			// Disregard rooms that are too far away to reach quickly.
			const cannotFindShorterPath = Game.map.getRoomLinearDistance(sourcePosition.roomName, room.name) > Math.ceil(minPathLength / 50);
			if (minPathLength < hivemind.settings.get('maxRemoteMinePathLength') && cannotFindShorterPath) continue;
			if (!room.roomPlanner) continue;

			const storagePos = room.roomPlanner.getLocations('storage')[0];
			if (!storagePos) continue;

			const result = PathFinder.search(sourcePosition, {pos: storagePos, range: 1}, {
				plainCost: 2,
				swampCost: 10,
				maxOps: 10_000, // The default 2000 can be too little even at a distance of only 2 rooms.
				roomCallback: roomName => this.getCostMatrix(roomName),
			});

			if (!result || result.incomplete || result.path.length >= minPathLength) continue;

			minPath = result.path;
			minPathLength = result.path.length;
		}

		// @todo Register this path so we know which rooms it touches.
		memory.generated = Game.time;
		memory.path = minPath ? packPosList(minPath) : null;

		return minPath;
	}

	getCostMatrix(roomName: string): CostMatrix | false {
		return cache.inHeap('remotePathManagerCostMatrix:' + roomName, 1000, () => {
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

			if (_.size(roomIntel.getStructures(STRUCTURE_KEEPER_LAIR)) > 0) {
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
		})
	}
}
