'use strict';

const Process = require('./process');

const ManageLabsProcess = function (params, data) {
	Process.call(this, params, data);
	this.room = params.room;
};

ManageLabsProcess.prototype = Object.create(Process.prototype);

/**
 * Moves energy between links.
 *
 * Determines which links serve as energy input or output, and transfers
 * dynamically between those and neutral links.
 */
ManageLabsProcess.prototype.run = function () {
	const memory = this.room.memory;
	if (!memory.canPerformReactions || !memory.currentReaction) return;

	const source1 = Game.getObjectById(memory.labs.source1);
	const source2 = Game.getObjectById(memory.labs.source2);
	if (!source1 || !source2) return;
	if (source1.mineralType !== memory.currentReaction[0] || source2.mineralType !== memory.currentReaction[1]) return;

	const labs = memory.labs.reactor;
	if (!labs) return;

	for (const i in labs) {
		const reactor = Game.getObjectById(labs[i]);

		if (reactor && reactor.cooldown <= 0) {
			reactor.runReaction(source1, source2);
		}
	}
};

module.exports = ManageLabsProcess;
