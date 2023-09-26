import cache from 'utils/cache';

declare global {
	type ExitCoords = Record<string, RoomPosition[]>;
}

function getExitCenters(roomName: string): ExitCoords {
	return cache.inHeap('exitCenters:' + roomName, 10_000, () => {
		const exitCoords = getExitCoordsByDirection(roomName);
		return findExitCenters(roomName, exitCoords);
	});
}

function getExitCoordsByDirection(roomName: string): ExitCoords {
	const terrain = new Room.Terrain(roomName);

	const exitCoords: ExitCoords = {
		N: [],
		S: [],
		W: [],
		E: [],
	};

	for (let i = 1; i < 49; i++) {
		if (terrain.get(0, i) !== TERRAIN_MASK_WALL) exitCoords.W.push(new RoomPosition(0, i, roomName));
		if (terrain.get(49, i) !== TERRAIN_MASK_WALL) exitCoords.E.push(new RoomPosition(49, i, roomName));
		if (terrain.get(i, 0) !== TERRAIN_MASK_WALL) exitCoords.N.push(new RoomPosition(i, 0, roomName));
		if (terrain.get(i, 49) !== TERRAIN_MASK_WALL) exitCoords.S.push(new RoomPosition(i, 49, roomName));
	}

	return exitCoords;
}

/**
 * Finds center positions of all room exits.
 *
 * @return {object}
 *   Array of RoomPosition objects, keyed by exit direction.
 */
function findExitCenters(roomName: string, exitCoords: ExitCoords): ExitCoords {
	const exitCenters: ExitCoords = {};

	for (const dir of _.keys(exitCoords)) {
		exitCenters[dir] = [];

		let startPos = null;
		let previousPos = null;
		for (const pos of exitCoords[dir]) {
			if (!startPos) {
				startPos = pos;
			}

			if (previousPos && pos.getRangeTo(previousPos) > 1) {
				// New exit block started.
				const middlePos = new RoomPosition(Math.ceil((previousPos.x + startPos.x) / 2), Math.ceil((previousPos.y + startPos.y) / 2), roomName);
				exitCenters[dir].push(middlePos);

				startPos = pos;
			}

			previousPos = pos;
		}

		if (startPos) {
			// Finish last wall run.
			const middlePos = new RoomPosition(Math.ceil((previousPos.x + startPos.x) / 2), Math.ceil((previousPos.y + startPos.y) / 2), roomName);
			exitCenters[dir].push(middlePos);
		}
	}

	return exitCenters;
}

export {
	getExitCenters,
};
