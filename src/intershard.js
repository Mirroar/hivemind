'use strict';

/* global InterShardMemory */

const interShard = {

	/**
	 * Gets the memory object for the current shard.
	 *
	 * @return {object}
	 *   This shard's inter-shard memory.
	 */
	getLocalMemory() {
		if (!this._memory) {
			this._memory = JSON.parse(InterShardMemory.getLocal()) || {};
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
	getRemoteMemory(shardName) {
		return JSON.parse(InterShardMemory.getRemote(shardName)) || {};
	},

	/**
	 * Registers a portal in intershard memory.
	 *
	 * @param {StructurePortal} portal
	 *   The portal to register.
	 */
	registerPortal(portal) {
		const memory = this.getLocalMemory();
		const targetShard = portal.destination.shard;

		if (!memory.portals) memory.portals = {};
		if (!memory.portals[targetShard]) memory.portals[targetShard] = {};
		memory.portals[targetShard][portal.room.name] = portal.destination.room;

		this.writeLocalMemory();
	},

};

module.exports = interShard;
