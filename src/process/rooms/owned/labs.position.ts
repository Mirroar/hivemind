/* global FIND_STRUCTURES STRUCTURE_LAB */

import Process from 'process/process';

declare global {
	interface RoomMemory {
		canPerformReactions;
		labs;
	}
}

export default class ReactionsProcess extends Process {
	room: Room;

	/**
	 * Checks which labs are close to each other and can perform reactions.
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
	 * Detects labs that are close to each other.
	 */
	run() {
		// @todo Find labs not used for reactions, to do creep boosts.
		this.room.memory.canPerformReactions = false;

		const labs = _.filter(this.room.myStructuresByType[STRUCTURE_LAB], structure => structure.isOperational());
		if (labs.length < 3) return;

		// Find best 2 source labs for other labs to perform reactions.
		let best: {
			source1: Id<StructureLab>;
			source2: Id<StructureLab>;
			reactor: Array<Id<StructureLab>>;
		} = null;
		for (const lab of labs) {
			const closeLabs = labs.filter(otherLab => lab.pos.getRangeTo(otherLab) <= 2 && otherLab.id !== lab.id);
			if (closeLabs.length < 2) continue;

			for (const lab2 of closeLabs) {
				const reactors: Array<Id<StructureLab>> = [];
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
