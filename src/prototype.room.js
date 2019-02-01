'use strict';

/* global Room */

if (!Room.prototype.__enhancementsLoaded) {
	require('./prototype.room.creeps');
	require('./prototype.room.intel');
	require('./prototype.room.pathfinding');
	require('./prototype.room.resources');
	require('./prototype.room.structures');

	Room.prototype.__enhancementsLoaded = true;
}
