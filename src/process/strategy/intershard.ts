import Process from 'process/process';
import hivemind from 'hivemind';
import interShard from 'intershard';
import NavMesh from 'utils/nav-mesh';
import Squad from 'manager.squad';
import {decodePosition} from 'utils/serialization';
import {getRoomIntel} from 'room-intel';

const minRoomLevelToIntershardScout = 7;

/**
 * Chooses rooms for expansion and sends creeps there.
 */
export default class InterShardProcess extends Process {
	memory;
	_shardData;

	navMesh: NavMesh;

	/**
	 * Makes decisions concerning inter-shard travel.
	 */
	run() {
		this.memory = interShard.getLocalMemory();

		this.navMesh = new NavMesh();

		this.updateShardInfo();
		this.distributeCPU();
		this.manageScouting();
		this.manageExpanding();
		this.manageExpansionSupport();

		interShard.writeLocalMemory();
	}

	/**
	 * Updates general info in intershard memory.
	 */
	updateShardInfo() {
		if (!this.memory.info) this.memory.info = {};

		this.memory.info.ownedRooms = Game.myRooms.length;
		this.memory.info.ownedCreeps = _.size(Game.creeps);

		// Determine highest room level.
		this.memory.info.maxRoomLevel = 0;
		for (const room of Game.myRooms) {
			if (room.controller.level > this.memory.info.maxRoomLevel) {
				this.memory.info.maxRoomLevel = room.controller.level;
			}
		}

		// Determine significant rooms.
		this.memory.info.rooms = {};
		const roomStats = this.memory.info.rooms;
		_.each(Memory.strategy.roomList, (info, roomName) => {
			if (!info.expansionScore || info.expansionScore <= 0) return;

			if (!Game.rooms[roomName] || !Game.rooms[roomName].isMine()) {
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
	}

	/**
	 * Determines CPU allocation for each active shard.
	 */
	distributeCPU() {
		// @todo Only run on "main" shard.
		if (!Game.cpu.setShardLimits) return;

		// Collect information about shards so we can estimate CPU needs.
		this._shardData = {
			total: {
				neededCpu: 0,
			},
		};
		this.addShardData(Game.shard.name, this.memory);

		// Based on collected information, assign CPU to each shard.
		const totalCpu = _.sum(Game.cpu.shardLimits);
		const newLimits = {};
		_.each(this._shardData, (data, shardName) => {
			if (shardName === 'total') return;

			newLimits[shardName] = Math.round(totalCpu * data.neededCpu / this._shardData.total.neededCpu);
		});
		Game.cpu.setShardLimits(newLimits);
	}

	/**
	 * Collects and stores CPU requirements for a shard and its neighbors.
	 *
	 * @param {String} shardName
	 *   Name of the shard to check.
	 * @param {object|null} shardMemory
	 *   The shard's memory object, if available.
	 */
	addShardData(shardName, shardMemory?: any) {
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
			this._shardData[shardName].neededCpu = 3 + this._shardData[shardName].rooms + (this._shardData[shardName].creeps / 10);

			if (shardMemory.info.interShardExpansion) {
				// Allow for more CPU while creating out first intershard room.
				this._shardData[shardName].neededCpu += 3;
			}
		}
		else {
			_.each(this._shardData, (data, compareShard) => {
				if (compareShard === 'total') return;

				const compareMemory = compareShard === Game.shard.name ? interShard.getLocalMemory() : interShard.getRemoteMemory(compareShard);
				if (!compareMemory.info) return;
				if (!compareMemory.portals || !compareMemory.portals[shardName]) return;
				if ((compareMemory.info.maxRoomLevel || 0) < minRoomLevelToIntershardScout) return;

				// If we have at least one high-level room, assign a little CPU to unexplored
				// adjacent shards for scouting.
				this._shardData[shardName].neededCpu = 0.5;
			});
		}

		this._shardData.total.neededCpu += this._shardData[shardName].neededCpu;

		_.each(shardMemory.portals, (portals, otherShardName) => {
			this.addShardData(otherShardName);
		});
	}

	/**
	 * Manages scouting adjacent shards.
	 */
	manageScouting() {
		this.memory.scouting = {};
		if (this.memory.info.maxRoomLevel < minRoomLevelToIntershardScout) return;

		// Scout nearby shards that have no rooms claimed.
		for (const shardName in this.memory.portals) {
			if (this._shardData[shardName].rooms === 0) {
				this.memory.scouting[shardName] = true;
			}
		}
	}

	/**
	 * Manages requesting an expansion squad from a nearby shard.
	 */
	manageExpanding() {
		if (!hivemind.segmentMemory.isReady()) return;

		if (this.memory.info.ownedRooms > 0) {
			// Remove expansion request when our room has hopefully stabilized.
			if (this.memory.info.maxRoomLevel >= 4) {
				this.removeIntershardExpansionRequest();
			}

			return;
		}

		// Don't recalculate if we've already set a target.
		// Unless expanding has failed, e.g. due to attacks.
		if (this.memory.info.interShardExpansion) {
			if (this.memory.info.interShardExpansion.start && Game.time - this.memory.info.interShardExpansion.start < 50 * CREEP_LIFE_TIME) return;

			this.failIntershardExpansion();
		}

		this.startIntershardExpansion();
	}

	failIntershardExpansion() {
		if (!Memory.strategy.expand.failedExpansions)
			Memory.strategy.expand.failedExpansions = [];
		Memory.strategy.expand.failedExpansions.push({
			roomName: this.memory.info.interShardExpansion.room,
			time: Game.time,
		});

		hivemind.log('strategy').notify('💀 Intershard expansion to ' + this.memory.info.interShardExpansion.room + ' has failed. A new target will be chosen soon.');

		this.removeIntershardExpansionRequest();
	}

	removeIntershardExpansionRequest() {
		delete this.memory.info.interShardExpansion;

		const squad = new Squad('interShardExpansion');
		squad.clearUnits();
		squad.disband();
	}

	startIntershardExpansion() {
		// Immediately try to expand to the best known room.
		// @todo Decide when we've scouted enough to claim a room.
		if (!this.memory.info.rooms.bestExpansion) return;

		const targetRoom = this.memory.info.rooms.bestExpansion.name;
		const roomIntel = getRoomIntel(targetRoom);

		const expansionInfo = {
			room: targetRoom,
			portalRoom: null,
			start: Game.time,
		};
		expansionInfo.portalRoom = Memory.strategy.roomList[targetRoom].origin;

		this.memory.info.interShardExpansion = expansionInfo;

		// Preliminarily create `interShardExpansion` squad. It will be filled
		// by creeps travelling here through a portal.
		const squad = new Squad('interShardExpansion');
		squad.clearUnits();
		squad.addUnit('singleClaim');
		squad.addUnit('builder');
		squad.setTarget(roomIntel.getControllerPosition());
	}

	/**
	 * Manages a squad that sends claimers and builders for intershard expansion.
	 */
	manageExpansionSupport() {
		// Clear squad unit assignments for when no support is needed.
		const squad = new Squad('interShardSupport');
		squad.clearUnits();

		// Check if a shard we're scouting is trying to expand.
		_.each(this.memory.portals, (portals, shardName) => {
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
	}

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
	findClosestPortalToSpawnTo(roomName, targetShard) {
		let bestPortal;
		_.each(this.memory.portals, (portals, shardName) => {
			if (shardName !== targetShard) return;

			_.each(portals, (portalInfo, portalPosition) => {
				if (portalInfo.dest !== roomName) return;

				const pos = decodePosition(portalPosition);
				const bestSourceRoom = this.findClosestSpawn(pos.roomName);
				if (!bestSourceRoom) return;

				if (bestPortal && bestPortal.range <= bestSourceRoom.range) return;

				bestPortal = {
					pos,
					range: bestSourceRoom.range,
					origin: bestSourceRoom.name,
				};
			});
		});

		return bestPortal;
	}

	/**
	 * Finds the closest valid spawn location for an intershard expansion.
	 *
	 * @param {string} targetRoom
	 *   Name of the room we're expanding to.
	 *
	 * @return {string}
	 *   Name of the room to spawn from.
	 */
	findClosestSpawn(targetRoom: string): {name: string, range: number} | null {
		let bestRoom = null;
		let bestLength = 0;
		for (const room of Game.myRooms) {
			if (room.controller.level < 5) continue;
			if (room.name === targetRoom) continue;
			if (room.getEffectiveAvailableEnergy() < 30_000) continue;
			if (Game.map.getRoomLinearDistance(room.name, targetRoom) > 7) continue;

			const path = this.navMesh.findPath(new RoomPosition(25, 25, room.name), new RoomPosition(25, 25, targetRoom), {maxPathLength: 350});
			if (!path || path.incomplete) continue;

			if (!bestRoom || bestLength > path.path.length) {
				bestRoom = room;
				bestLength = path.path.length;
			}
		}

		return bestRoom && {
			name: bestRoom.name,
			range: bestLength,
		}
	}

}
