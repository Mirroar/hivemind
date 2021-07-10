'use strict';

/* global hivemind PathFinder */

const cache = require('./cache');
const packrat = require('./packrat');
const utilities = require('./utilities');

module.exports = class RemotePathManager {
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
						const isMyRoom = Game.rooms[roomName] && Game.rooms[roomName].isMine();
						const matrix = isMyRoom ? Game.rooms[roomName].roomPlanner.getNavigationMatrix().clone() : new PathFinder.CostMatrix();

						// @todo Set to 1 for each road used by other active remote mining paths in this room.

						// For now, we just use road locations from intel as a guide.
						const roomIntel = hivemind.roomIntel(roomName);
						const roads = roomIntel.getRoadCoords();
						for (const road of roads) {
							matrix.set(road.x, road.y, 1);
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
