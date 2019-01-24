'use strict';

var Process = require('process');

var ManageLabsProcess = function (params, data) {
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
	let memory = this.room.memory;
	if (!memory.canPerformReactions || !memory.currentReaction) return;

	var source1 = Game.getObjectById(memory.labs.source1);
	var source2 = Game.getObjectById(memory.labs.source2);
	if (!source1 || !source2) return;
	if (source1.mineralType != memory.currentReaction[0] || source2.mineralType != memory.currentReaction[1]) return;

	var labs = memory.labs.reactor;
	if (!labs) return;

	for (let i in labs) {
		var reactor = Game.getObjectById(labs[i]);

		if (reactor && reactor.cooldown <= 0) {
			reactor.runReaction(source1, source2);
		}
	}
};

module.exports = ManageLabsProcess;
