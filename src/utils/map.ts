import {getRoomIntel} from 'room-intel';

/**
 * Runs a function for every tile in range around a given center coordinate.
 *
 * @param {number} x
 *   Center tile's x coordinate.
 * @param {number} y
 *   Center tile's y coordinate.
 * @param {function} callback
 *   Callback that gets invoked for every tile with x and y coordinates as
 *   arguments. It may explicitly return false to stop looping through tiles.
 * @param {number} range
 *   (Optional) Range around the center to run code for. Defaults to 1.
 */
function handleMapArea(x: number, y: number, callback: TileCallback, range?: number) {
	if (typeof range === 'undefined') range = 1;
	for (let dx = -range; dx <= range; dx++) {
		if (x + dx < 0) continue;
		if (x + dx >= 50) continue;
		for (let dy = -range; dy <= range; dy++) {
			// Clamp to map boundaries.
			if (y + dy < 0) continue;
			if (y + dy >= 50) continue;
			if (callback(x + dx, y + dy) === false) return;
		}
	}
}

export {
	handleMapArea,
};
