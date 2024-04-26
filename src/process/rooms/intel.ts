/* global FIND_HOSTILE_STRUCTURES STRUCTURE_INVADER_CORE */

import Process from 'process/process';
import hivemind from 'hivemind';
import {getRoomIntel} from 'room-intel';

declare global {
	interface RoomMemory {
		enemies: EnemyData;
	}

	interface EnemyData {
		parts: Record<string, number>;
		lastSeen: number;
		expires?: number;
		safe: boolean;
		damage: number;
		heal: number;
		hasInvaderCore?: boolean;
	}
}

export default class RoomIntelProcess extends Process {
	room: Room;

	/**
	 * Gathers tick-by-tick intel in a room.
	 *
	 * @param {object} parameters
	 *   Options on how to run this process.
	 */
	constructor(parameters: RoomProcessParameters) {
		super(parameters);
		this.room = parameters.room;
	}

	/**
	 * Gathers intel in a room.
	 */
	run() {
		getRoomIntel(this.room.name).gatherIntel();
		this.room.scan();

		this.findHostiles();
	}

	/**
	 * Detects hostile creeps.
	 */
	findHostiles() {
		const parts = {};
		let lastSeen = this.room.memory.enemies ? this.room.memory.enemies.lastSeen : 0;
		let expires = null;
		let safe = true;
		let healCapacity = 0;
		let damageCapacity = 0;
		let hasInvaderCore = false;

		_.each(this.room.enemyCreeps, (hostiles, owner) => {
			if (hivemind.relations.isAlly(owner)) return;

			// Count body parts for strength estimation.
			for (const creep of hostiles) {
				if (creep.isDangerous()) {
					if (
						creep.owner.username === 'Source Keeper'
						&& _.min(_.map(this.room.structuresByType[STRUCTURE_KEEPER_LAIR], (s: StructureKeeperLair) => s.pos.getRangeTo(creep.pos))) <= 5
					) {
						// We ignore source keepers for total enemy strength.
						continue;
					}

					safe = false;
					lastSeen = Game.time;
					healCapacity += creep.getHealCapacity(1);
					damageCapacity += creep.getDamageCapacity(1);
					if (!expires || expires < Game.time + creep.ticksToLive) {
						expires = Game.time + creep.ticksToLive;
					}
				}

				for (const part of creep.body) {
					parts[part.type] = (parts[part.type] || 0) + 1;
				}
			}
		});

		if (this.room.isMine() && !safe) {
			this.room.assertMilitarySituation();
		}

		for (const structure of this.room.structuresByType[STRUCTURE_INVADER_CORE] || []) {
			hasInvaderCore = true;
			safe = safe && (structure.level === 0 || (structure.ticksToDeploy ?? 0) > 1000);
			lastSeen = Game.time;

			for (const effect of (structure.effects || [])) {
				if (effect.effect === EFFECT_COLLAPSE_TIMER) {
					if (!expires || expires < Game.time + effect.ticksRemaining) {
						expires = Game.time + effect.ticksRemaining;
					}
				}
			}
		}

		this.room.memory.enemies = {
			parts,
			lastSeen,
			expires,
			safe,
			damage: damageCapacity,
			heal: healCapacity,
			hasInvaderCore,
		};

		if (this.room.memory.enemies.safe && !this.room.memory.enemies.hasInvaderCore && _.size(this.room.memory.enemies.parts) === 0) delete this.room.memory.enemies;
	}
}
