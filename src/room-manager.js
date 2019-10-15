'use strict';

/* global STRUCTURE_ROAD STRUCTURE_WALL FIND_STRUCTURES
FIND_HOSTILE_STRUCTURES */

const utilities = require('./utilities');

module.exports = class RoomManager {
	/**
	 * @todo Documentation.
	 */
	constructor(room) {
		this.room = room;
		this.roomPlanner = room.roomPlanner;
	}

	/**
	 * @todo Documentation.
	 */
	runLogic() {
		this.roomStructures = this.room.find(FIND_STRUCTURES);
		this.structuresByType = _.groupBy(this.roomStructures, 'structureType');
	}

	/**
	 * Removes structures that might prevent the room's construction.
	 */
	cleanRoom() {
		// Remove all roads not part of current room plan.
		for (const road of this.structuresByType[STRUCTURE_ROAD] || []) {
			if (!this.roomPlanner.isPlannedLocation(road.pos, 'road')) {
				road.destroy();
			}
		}

		// Remove unwanted walls that might block initial buildings.
		for (const wall of this.structuresByType[STRUCTURE_WALL] || []) {
			if (
				this.roomPlanner.isPlannedLocation(wall.pos, 'road') ||
				this.roomPlanner.isPlannedLocation(wall.pos, 'spawn') ||
				this.roomPlanner.isPlannedLocation(wall.pos, 'storage') ||
				this.roomPlanner.isPlannedLocation(wall.pos, 'extension')
			) {
				wall.destroy();
			}
		}

		// Remove hostile structures.
		for (const structure of this.room.find(FIND_HOSTILE_STRUCTURES)) {
			structure.destroy();
		}
	}
};
