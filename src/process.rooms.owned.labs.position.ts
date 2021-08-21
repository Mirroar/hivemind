/* global FIND_STRUCTURES STRUCTURE_LAB */

declare global {
	interface RoomMemory {
		canPerformReactions,
		labs,
	}
}

import Process from './process';

export default class ReactionsProcess extends Process {
	room: Room;

	/**
	 * Checks which labs are close to each other and can perform reactions.
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
	 * Detects labs that are close to each other.
	 */
	run() {
		// @todo Find labs not used for reactions, to do creep boosts.
		this.room.memory.canPerformReactions = false;

		const labs = this.room.find(FIND_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_LAB && structure.isOperational(),
		});
		if (labs.length < 3) return;

		// Find best 2 source labs for other labs to perform reactions.
		let best = null;
		for (const lab of labs) {
			const closeLabs = lab.pos.findInRange(FIND_STRUCTURES, 2, {
				filter: structure => structure.structureType === STRUCTURE_LAB && structure.id !== lab.id,
			});
			if (closeLabs.length < 2) continue;

			for (const lab2 of closeLabs) {
				const reactors = [];
				for (const reactor of closeLabs) {
					if (reactor === lab || reactor === lab2) continue;
					if (reactor.pos.getRangeTo(lab2) > 2) continue;

					reactors.push(reactor.id);
				}

				if (reactors.length === 0) continue;
				if (!best || best.reactor.length < reactors.length) {
					best = {
						source1: lab.id,
						source2: lab2.id,
						reactor: reactors,
					};
				}
			}
		}

		if (best) {
			this.room.memory.canPerformReactions = true;
			this.room.memory.labs = best;
		}
	}
}
