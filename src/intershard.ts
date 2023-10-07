/* global InterShardMemory */

import {encodePosition} from 'utils/serialization';

declare global {
	interface Memory {
		interShardReplacement: any;
	}

	interface ShardMemory {
		portals?: Record<string, Record<string, {
			dest: string;
			scouted?: number;
		}>>;
	}

	namespace NodeJS {
		interface Global {
			interShard: typeof interShard;
		}
	}
}

const interShard = {
	/**
	 * Gets the memory object for the current shard.
	 *
	 * @return {object}
	 *   This shard's inter-shard memory.
	 */
	getLocalMemory(): ShardMemory {
		if (typeof InterShardMemory === 'undefined') {
			// Create mock intershard memory object.
			if (!Memory.interShardReplacement) Memory.interShardReplacement = {};

			this._memory = Memory.interShardReplacement;
			return this._memory;
		}

		if (!this._memory || Game.time !== this._memoryAge) {
			this._memory = JSON.parse(InterShardMemory.getLocal()) || {};
			this._memoryAge = Game.time;
		}

		return this._memory;
	},

	/**
	 * Writes the memory object for the current shard.
	 *
	 * This should only be called at the end of the current tick when no more
	 * changes are expected.
	 */
	writeLocalMemory() {
		// @todo Only serialize memory once per tick.
		if (!this._memory) return;
		if (typeof InterShardMemory === 'undefined') return;

		InterShardMemory.setLocal(JSON.stringify(this._memory));
	},

	/**
	 * Gets the memory object for another shard.
	 *
	 * @param {String} shardName
	 *   The name of the shard for which memory is requested.
	 *
	 * @return {object}
	 *   The shard's inter-shard memory.
	 */
	getRemoteMemory(shardName): ShardMemory {
		if (typeof InterShardMemory === 'undefined') return {};

		return JSON.parse(InterShardMemory.getRemote(shardName)) || {};
	},

	/**
	 * Registers a portal in intershard memory.
	 *
	 * @param {StructurePortal} portal
	 *   The portal to register.
	 */
	registerPortal(portal: StructurePortal) {
		if (!('shard' in portal.destination)) return;

		const memory = this.getLocalMemory();
		const targetShard = portal.destination.shard;

		if (!memory.portals) memory.portals = {};
		if (!memory.portals[targetShard]) memory.portals[targetShard] = {};
		const pos = encodePosition(portal.pos);
		if (!memory.portals[targetShard][pos]) {
			memory.portals[targetShard][pos] = {};
		}

		memory.portals[targetShard][pos].dest = portal.destination.room;

		this.writeLocalMemory();
	},

};

export default interShard;
global.interShard = interShard;
