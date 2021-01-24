'use strict';

/* global RoomPosition */

const interShard = require('./intershard');
const Process = require('./process');
const Squad = require('./manager.squad');
const utilities = require('./utilities');

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
	this.manageScouting();
	this.manageExpanding();
	this.manageExpansionSupport();

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

	// Determine significant rooms.
	this.memory.info.rooms = {};
	const roomStats = this.memory.info.rooms;
	_.each(Memory.strategy.roomList, (info, roomName) => {
		if (info.range > 0) {
			// The following scores only apply to unowned rooms.
			if (!roomStats.bestExpansion || roomStats.bestExpansion.score < info.expansionScore) {
				roomStats.bestExpansion = {
					name: roomName,
					score: info.expansionScore,
				};
			}
		}
		else {
			// The following scores only apply to owned rooms.
			if (!roomStats.bestRoom || roomStats.bestRoom.score < info.expansionScore) {
				roomStats.bestRoom = {
					name: roomName,
					score: info.expansionScore,
				};
			}

			if (!roomStats.worstRoom || roomStats.worstRoom.score > info.expansionScore) {
				roomStats.worstRoom = {
					name: roomName,
					score: info.expansionScore,
				};
			}
		}
	});
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

		if (shardMemory.info.interShardExpansion) {
			// Allow for more CPU while creating out first intershard room.
			this._shardData[shardName].neededCpu += 1;
		}
	}
	else if (this.memory.info.maxRoomLevel === 8) {
		// If we have at least one level 8 room, assign a little CPU to unexplored
		// shards for scouting.
		this._shardData[shardName].neededCpu = 0.5;
	}

	this._shardData.total.neededCpu += this._shardData[shardName].neededCpu;

	_.each(shardMemory.portals, (portals, otherShardName) => this.addShardData(otherShardName));
};

/**
 * Manages scouting adjacent shards.
 */
InterShardProcess.prototype.manageScouting = function () {
	this.memory.scouting = {};
	if (this.memory.info.maxRoomLevel < 8) return;

	// Scout nearby shards that have no rooms claimed.
	for (const shardName in this.memory.portals) {
		if (this._shardData[shardName].rooms === 0) {
			this.memory.scouting[shardName] = true;
		}
	}
};

/**
 * Manages requesting an expansion squad from a nearby shard.
 */
InterShardProcess.prototype.manageExpanding = function () {
	if (this.memory.info.ownedRooms > 0) {
		// Remove expansion request when our room has hopefully stabilized.
		if (this.memory.info.maxRoomLevel >= 4) {
			delete this.memory.info.interShardExpansion;
			const squad = new Squad('interShardExpansion');
			squad.clearUnits();
			squad.disband();
		}

		return;
	}

	// Don't recalculate if we've already set a target.
	// @todo Unless expanding has failed, e.g. due to attacks.
	if (this.memory.info.interShardExpansion) return;

	// Immediately try to expand to the best known room.
	// @todo Decide when we've scouted enough to claim a room.
	if (!this.memory.info.rooms.bestExpansion) return;

	const targetRoom = this.memory.info.rooms.bestExpansion.name;
	const expansionInfo = {
		room: targetRoom,
	};
	expansionInfo.portalRoom = Memory.strategy.roomList[targetRoom].origin;

	this.memory.info.interShardExpansion = expansionInfo;

	// Preliminarily create `interShardExpansion` squad.
	const squad = new Squad('interShardExpansion');
	squad.clearUnits();
	squad.addUnit('singleClaim');
	squad.addUnit('builder');
	squad.setTarget(new RoomPosition(25, 25, targetRoom));
};

/**
 * Manages a squad that sends claimers and builders for intershard expansion.
 */
InterShardProcess.prototype.manageExpansionSupport = function () {
	// Clear squad unit assignments for when no support is needed.
	const squad = new Squad('interShardSupport');
	squad.clearUnits();

	// Check if a shard we're scouting is trying to expand.
	_.each(this.memory.scouting, (isScouting, shardName) => {
		if (!isScouting) return;

		const remoteMemory = interShard.getRemoteMemory(shardName);
		if (!remoteMemory.info || !remoteMemory.info.interShardExpansion) return;

		const targetRoom = remoteMemory.info.interShardExpansion.portalRoom;
		const bestPortal = this.findClosestPortalToSpawnTo(targetRoom, shardName);
		if (!bestPortal) return;

		// Send units to facilitate expansion.
		if (remoteMemory.info.maxRoomLevel === 0) squad.addUnit('singleClaim');
		squad.setUnitCount('builder', 2);
		squad.setTarget(bestPortal.pos);
		squad.setSpawn(bestPortal.origin);
	});
};

/**
 * Finds the portal that leads to the target room and is close to an owned room.
 *
 * @param {String} roomName
 *   The name of the room we're trying to reach via portal.
 * @param {String} targetShard
 *   The shard we're trying to reach.
 *
 * @return {RoomPosition}
 *   Position of the portal we should take to get to the target room.
 */
InterShardProcess.prototype.findClosestPortalToSpawnTo = function (roomName, targetShard) {
	let bestPortal;
	_.each(this.memory.portals, (portals, shardName) => {
		if (shardName !== targetShard) return;

		_.each(portals, (portalInfo, portalPosition) => {
			if (portalInfo.dest !== roomName) return;

			const pos = utilities.decodePosition(portalPosition);
			const roomInfo = Memory.strategy.roomList[pos.roomName];
			if (bestPortal && bestPortal.range <= roomInfo.range) return;

			bestPortal = {
				pos,
				range: roomInfo.range,
				origin: roomInfo.origin,
			};
		});
	});

	return bestPortal;
};

module.exports = InterShardProcess;
