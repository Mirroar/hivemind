'use strict';

/* global Room */

if (!Room.prototype.__enhancementsLoaded) {
	require('./room.prototype.creeps');
	require('./room.prototype.intel');
	require('./room.prototype.pathfinding');
	require('./room.prototype.resources');
	require('./room.prototype.structures');

	Room.prototype.__enhancementsLoaded = true;
}
