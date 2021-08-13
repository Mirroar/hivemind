'use strict';

/* global hivemind PathFinder STRUCTURE_KEEPER_LAIR */

import hivemind from './hivemind';
import cache from './cache';
import packrat from './packrat';
import utilities from './utilities';

export default class RemotePathManager {
	getPathFor(sourcePosition) {
		if (!hivemind.segmentMemory.isReady()) return;

		const key = 'remotePath:' + utilities.encodePosition(sourcePosition);
		if (!hivemind.segmentMemory.has(key)) {
			hivemind.segmentMemory.set(key, {});
		}

		const memory = hivemind.segmentMemory.get(key);
		if (memory.generated && !hivemind.hasIntervalPassed(1000, memory.generated)) {
			if (!memory.path) return null;

			return packrat.unpackPosList(memory.path);
		}

		const availableSourceRooms = _.filter(Game.rooms, r => r.isMine() && Game.map.getRoomLinearDistance(sourcePosition.roomName, r.name) <= hivemind.settings.get('maxRemoteMineRoomDistance'));
		const sortedByDist = _.sortBy(_.values(availableSourceRooms), r => Game.map.getRoomLinearDistance(sourcePosition.roomName, r.name));

		let minPath;
		let minPathLength = hivemind.settings.get('maxRemoteMinePathLength') + 50;
		for (const room of sortedByDist) {
			// Disregard rooms that are too far away to reach quickly.
			if (minPathLength < hivemind.settings.get('maxRemoteMinePathLength') && Game.map.getRoomLinearDistance(sourcePosition.roomName, room.name) > Math.ceil(minPathLength / 50)) continue;
			if (!room.roomPlanner) continue;

			const storagePos = room.roomPlanner.getLocations('storage')[0];
			if (!storagePos) continue;

			const result = PathFinder.search(sourcePosition, {pos: storagePos, range: 1}, {
				plainCost: 2,
				swampCost: 10,
				maxRooms: hivemind.settings.get('maxRemoteMineRoomDistance') + 1,
				maxOps: 10000, // The default 2000 can be too little even at a distance of only 2 rooms.
				roomCallback: roomName => {
					return cache.inHeap('remotePathManagerCostMatrix:' + roomName, 1000, () => {
						const roomIntel = hivemind.roomIntel(roomName);

						// Don't path through rooms owned by other players.
						if (roomIntel.isOwned()) return false;

						// Initialize a cost matrix for this room.
						const isMyRoom = Game.rooms[roomName] && Game.rooms[roomName].isMine();
						const matrix = isMyRoom ? Game.rooms[roomName].roomPlanner.getNavigationMatrix().clone() : new PathFinder.CostMatrix();

						// @todo Set to 1 for each road used by other active remote mining paths in this room.
						// For now, we just use road locations from intel as a guide.
						const roads = roomIntel.getRoadCoords();
						for (const road of roads) {
							if (matrix.get(road.x, road.y) === 0) matrix.set(road.x, road.y, 1);
						}

						if (_.size(roomIntel.getStructures(STRUCTURE_KEEPER_LAIR)) > 0) {
							// Disallow areas around source keeper sources.
							_.each(roomIntel.getSourcePositions(), sourceInfo => {
								utilities.handleMapArea(sourceInfo.x, sourceInfo.y, (x, y) => {
									matrix.set(x, y, 255);
								}, 4);
							});

							// Disallow areas around source keeper minerals.
							const mineralInfo = roomIntel.getMineralPosition();
							if (mineralInfo) {
								utilities.handleMapArea(mineralInfo.x, mineralInfo.y, (x, y) => {
									matrix.set(x, y, 255);
								}, 4);
							}
						}

						return matrix;
					});
				},
			});

			if (!result || result.incomplete || result.path.length >= minPathLength) continue;

			minPath = result.path;
			minPathLength = result.path.length;
		}

		// @todo Register this path so we know which rooms it touches.
		memory.generated = Game.time;
		memory.path = minPath ? packrat.packPosList(minPath) : null;

		return minPath;
	}
};
