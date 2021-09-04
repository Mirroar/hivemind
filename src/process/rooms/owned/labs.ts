import hivemind from 'hivemind';
import {PROCESS_PRIORITY_LOW} from 'hivemind';
import Process from 'process/process';
import ReactionsProcess from 'process/rooms/owned/labs.reactions';
import PositionsProcess from 'process/rooms/owned/labs.position';

export default class ManageLabsProcess extends Process {
	room: Room;

	/**
	 * Runs reactions in a room's labs.
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
	};

	/**
	 * Runs reactions in a room's labs.
	 */
	run() {
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

		const source1 = Game.getObjectById<StructureLab>(memory.labs.source1);
		const source2 = Game.getObjectById<StructureLab>(memory.labs.source2);
		if (!source1 || !source2) return;
		if (source1.mineralType !== memory.currentReaction[0] || source2.mineralType !== memory.currentReaction[1]) return;

		const labs = memory.labs.reactor;
		if (!labs) return;

		for (const reactorID of labs) {
			const reactor = Game.getObjectById<StructureLab>(reactorID);

			if (reactor && reactor.cooldown <= 0) {
				reactor.runReaction(source1, source2);
			}
		}
	}
}
