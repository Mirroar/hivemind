'use strict';

/* global */

const Process = require('./process');
const interShard = require('./intershard');

/**
 * Chooses rooms for expansion and sends creeps there.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const InterShardProcess = function (params, data) {
	Process.call(this, params, data);
};

InterShardProcess.prototype = Object.create(Process.prototype);

/**
 * Makes decisions concerning inter-shard travel.
 */
InterShardProcess.prototype.run = function () {
	this.memory = interShard.getLocalMemory();

	this.updateShardInfo();
	this.distributeCPU();

	interShard.writeLocalMemory();
};

/**
 * Updates general info in intershard memory.
 */
InterShardProcess.prototype.updateShardInfo = function () {
	if (!this.memory.info) this.memory.info = {};

	const ownedRooms = _.filter(Game.rooms, room => room.isMine());
	this.memory.info.ownedRooms = _.size(ownedRooms);
	this.memory.info.ownedCreeps = _.size(Game.creeps);

	// Determine highest room level.
	this.memory.info.maxRoomLevel = 0;
	for (const room of ownedRooms) {
		if (room.controller.level > this.memory.info.maxRoomLevel) {
			this.memory.info.maxRoomLevel = room.controller.level;
		}
	}
};

/**
 * Determines CPU allocation for each active shard.
 */
InterShardProcess.prototype.distributeCPU = function () {
	// Collect information about shards so we can estimate CPU needs.
	this._shardData = {
		total: {
			neededCpu: 0,
		},
	};
	this.addShardData(Game.shard.name, this._memory);

	// Based on collected information, assign CPU to each shard.
	const totalCpu = _.sum(Game.cpu.shardLimits);
	const newLimits = {};
	_.each(this._shardData, (data, shardName) => {
		if (shardName === 'total') return;

		newLimits[shardName] = Math.round(totalCpu * data.neededCpu / this._shardData.total.neededCpu);
	});
	Game.cpu.setShardLimits(newLimits);
};

/**
 * Collects and stores CPU requirements for a shard and its neighbors.
 *
 * @param {String} shardName
 *   Name of the shard to check.
 * @param {object|null} shardMemory
 *   The shard's memory object, if available.
 */
InterShardProcess.prototype.addShardData = function (shardName, shardMemory) {
	// Only handle each shard once.
	if (this._shardData[shardName]) return;

	if (!shardMemory) shardMemory = interShard.getRemoteMemory(shardName);

	this._shardData[shardName] = {
		rooms: 0,
		creeps: 0,
		neededCpu: 0,
	};

	if (shardMemory.info) {
		this._shardData[shardName].rooms = shardMemory.info.ownedRooms;
		this._shardData[shardName].creeps = shardMemory.info.ownedCreeps;
		this._shardData[shardName].neededCpu = 1 + this._shardData[shardName].rooms + (this._shardData[shardName].creeps / 10);
	}
	else if (this.memory.info.maxRoomLevel === 8) {
		// If we have at least one level 8 room, assign a little CPU to unexplored
		// shards for scouting.
		this._shardData[shardName].neededCpu = 0.5;
	}

	this._shardData.total.neededCpu += this._shardData[shardName].neededCpu;

	_.each(shardMemory.portals, (portals, otherShardName) => this.addShardData(otherShardName));
};

module.exports = InterShardProcess;
