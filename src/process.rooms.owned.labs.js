'use strict';

/* global hivemind PROCESS_PRIORITY_LOW */

const Process = require('./process');
const ReactionsProcess = require('./process.rooms.owned.labs.reactions');
const PositionsProcess = require('./process.rooms.owned.labs.position');

/**
 * Runs reactions in a room's labs.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const ManageLabsProcess = function (params, data) {
	Process.call(this, params, data);
	this.room = params.room;
};

ManageLabsProcess.prototype = Object.create(Process.prototype);

/**
 * Runs reactions in a room's labs.
 */
ManageLabsProcess.prototype.run = function () {
	// @todo Run only if there are at least 3 labs in the room.
	const memory = this.room.memory;

	// Check if enough labs are in a complex to perform reactions.
	hivemind.runProcess(this.room.name + '_labpositions', PositionsProcess, {
		interval: 3000,
		priority: PROCESS_PRIORITY_LOW,
		room: this.room,
	});

	if (!memory.canPerformReactions) return;
	// Make sure reactions are chosen periodically.
	hivemind.runProcess(this.room.name + '_reactions', ReactionsProcess, {
		interval: 1500,
		priority: PROCESS_PRIORITY_LOW,
		room: this.room,
	});

	if (!memory.currentReaction) return;

	const source1 = Game.getObjectById(memory.labs.source1);
	const source2 = Game.getObjectById(memory.labs.source2);
	if (!source1 || !source2) return;
	if (source1.mineralType !== memory.currentReaction[0] || source2.mineralType !== memory.currentReaction[1]) return;

	const labs = memory.labs.reactor;
	if (!labs) return;

	for (const reactorID of labs) {
		const reactor = Game.getObjectById(reactorID);

		if (reactor && reactor.cooldown <= 0) {
			reactor.runReaction(source1, source2);
		}
	}
};

module.exports = ManageLabsProcess;
