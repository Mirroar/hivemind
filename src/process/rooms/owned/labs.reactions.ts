/* global REACTIONS */

import container from 'utils/container';
import Process from 'process/process';
import hivemind from 'hivemind';

declare global {
	interface RoomMemory {
		currentReaction?: [ResourceConstant, ResourceConstant];
	}
}

export default class ReactionsProcess extends Process {
	room: Room;

	/**
	 * Manages which reactions take place in a room's labs.
	 * @constructor
	 *
	 * @param {object} parameters
	 *   Options on how to run this process.
	 */
	constructor(parameters: RoomProcessParameters) {
		super(parameters);
		this.room = parameters.room;
	}

	/**
	 * Sets appropriate reactions for each room depending on available resources.
	 */
	run() {
		if (this.room.isEvacuating()) {
			delete this.room.memory.currentReaction;
			return null;
		}

		const labManager = container.get('LabManager');
		const bestReaction = labManager.getReactionFor(this.room);

		this.room.memory.currentReaction = bestReaction;
		if (bestReaction) {
			hivemind.log('labs', this.room.name).info('now producing', REACTIONS[bestReaction[0]][bestReaction[1]]);
		}
	}
}
