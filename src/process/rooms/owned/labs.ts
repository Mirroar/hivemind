import Process from 'process/process';
import ReactionsProcess from 'process/rooms/owned/labs.reactions';
import PositionsProcess from 'process/rooms/owned/labs.position';
import hivemind, {PROCESS_PRIORITY_LOW} from 'hivemind';

declare global {
	interface RoomMemory {
		labUsage: {
			busy: number;
			idle: number;
			waiting: number;
			total: number;
		};
	}
}

export default class ManageLabsProcess extends Process {
	room: Room;

	/**
	 * Runs reactions in a room's labs.
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

		this.runReactions();
	}

	runReactions() {
		const memory = this.room.memory;

		const source1 = Game.getObjectById<StructureLab>(memory.labs.source1);
		const source2 = Game.getObjectById<StructureLab>(memory.labs.source2);
		if (!source1 || !source2) return;

		if (!memory.labUsage) {
			memory.labUsage = {
				busy: 0,
				idle: 0,
				waiting: 0,
				total: 0,
			};
		}

		memory.labUsage.total++;
		if (memory.labUsage.total >= 10_000) {
			memory.labUsage.busy /= 2;
			memory.labUsage.idle /= 2;
			memory.labUsage.waiting /= 2;
			memory.labUsage.total /= 2;
		}

		if (!memory.currentReaction) {
			memory.labUsage.idle++;
			return;
		}

		if (source1.mineralType !== memory.currentReaction[0] || source2.mineralType !== memory.currentReaction[1]) {
			memory.labUsage.waiting++;
			return;
		}

		const labs = memory.labs.reactor;
		if (!labs || labs.length === 0) {
			memory.labUsage.waiting++;
			return;
		}

		let totalLabs = 0;
		let busyLabs = 0;
		for (const reactorID of labs) {
			if (this.room.boostManager.isLabUsedForBoosting(reactorID)) continue;

			totalLabs++;
			const reactor = Game.getObjectById<StructureLab>(reactorID);
			if (reactor) {
				busyLabs++;
				if (!reactor.cooldown && reactor.runReaction(source1, source2) !== OK) busyLabs--;
			}
		}

		memory.labUsage.busy += busyLabs / totalLabs;
		memory.labUsage.waiting += (totalLabs - busyLabs) / totalLabs;
	}
}
