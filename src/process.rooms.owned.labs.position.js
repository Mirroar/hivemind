'use strict';

/* global FIND_STRUCTURES STRUCTURE_LAB */

const Process = require('./process');

/**
 * Checks which labs are close to each other and can perform reactions.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const ReactionsProcess = function (params, data) {
	Process.call(this, params, data);
	this.room = params.room;
};

ReactionsProcess.prototype = Object.create(Process.prototype);

/**
 * Detects labs that are close to each other.
 */
ReactionsProcess.prototype.run = function () {
	// @todo Find labs not used for reactions, to do creep boosts.
	this.room.memory.canPerformReactions = false;

	const labs = this.room.find(FIND_STRUCTURES, {
		filter: structure => structure.structureType === STRUCTURE_LAB && structure.isActive(),
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
};

module.exports = ReactionsProcess;
