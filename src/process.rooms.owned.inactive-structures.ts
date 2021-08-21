/* global FIND_MY_STRUCTURES CONTROLLER_STRUCTURES */

declare global {
	interface RoomMemory {
		inactiveStructures,
	}
}

import Process from './process';

export default class InactiveStructuresProcess extends Process {
	room: Room;

	/**
	 * Manages rooms we own.
	 * @constructor
	 *
	 * @param {object} params
	 *   Options on how to run this process.
	 * @param {object} data
	 *   Memory object allocated for this process' stats.
	 */
	constructor(params, data) {
		super(params, data);
		this.room = params.room;
	}

	/**
	 * Manages one of our rooms.
	 */
	run() {
		delete this.room.memory.inactiveStructures;

		// There are no inactive structures in fully upgraded rooms.
		const rcl = this.room.controller.level;
		if (rcl >= 8) return;

		this.room.memory.inactiveStructures = {};
		const groupedStructures: _.Dictionary<Structure[]> = _.groupBy(this.room.find(FIND_MY_STRUCTURES), 'structureType');
		_.each(groupedStructures, (structures, structureType) => {
			// Check if more structures than allowed exist.
			if (!CONTROLLER_STRUCTURES[structureType] || structures.length <= CONTROLLER_STRUCTURES[structureType][rcl]) return;

			for (const structure of structures) {
				if (!structure.isActive()) {
					this.room.memory.inactiveStructures[structure.id] = 1;
				}
			}
		});
	}
}
