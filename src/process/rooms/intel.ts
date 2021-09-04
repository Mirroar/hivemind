/* global FIND_HOSTILE_STRUCTURES STRUCTURE_INVADER_CORE */

import hivemind from 'hivemind';
import Process from 'process/process';

export default class RoomIntelProcess extends Process {
	room: Room;

	/**
	 * Gathers tick-by-tick intel in a room.
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
	 * Gathers intel in a room.
	 */
	run() {
		hivemind.roomIntel(this.room.name).gatherIntel();
		this.room.scan();

		this.findHostiles();
	}

	/**
	 * Detects hostile creeps.
	 */
	findHostiles() {
		const parts = {};
		let lastSeen = this.room.memory.enemies ? this.room.memory.enemies.lastSeen : 0;
		let safe = true;
		let healCapacity = 0;
		let damageCapacity = 0;

		_.each(this.room.enemyCreeps, (hostiles, owner) => {
			if (hivemind.relations.isAlly(owner)) return;

			// Count body parts for strength estimation.
			for (const creep of hostiles) {
				if (creep.isDangerous()) {
					safe = false;
					lastSeen = Game.time;
					healCapacity += creep.getHealCapacity(1);
					damageCapacity += creep.getDamageCapacity(1);
				}

				for (const part of creep.body) {
					parts[part.type] = (parts[part.type] || 0) + 1;
				}
			}
		});

		if (this.room.isMine() && !safe) {
			this.room.assertMilitarySituation();
		}

		for (const structure of this.room.find(FIND_HOSTILE_STRUCTURES)) {
			if (structure.structureType === STRUCTURE_INVADER_CORE) {
				safe = false;
				lastSeen = Game.time;
			}
		}

		this.room.memory.enemies = {
			parts,
			lastSeen,
			safe,
			damage: damageCapacity,
			heal: healCapacity,
		};
	}
}
