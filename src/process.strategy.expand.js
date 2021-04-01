'use strict';

/* global PathFinder Room RoomPosition CREEP_LIFE_TIME FIND_MY_CREEPS
TERRAIN_MASK_WALL FIND_STRUCTURES STRUCTURE_ROAD FIND_CONSTRUCTION_SITES
OBSTACLE_OBJECT_TYPES STRUCTURE_RAMPART */

const interShard = require('./intershard');
const Process = require('./process');
const Squad = require('./manager.squad');
const stats = require('./stats');

/**
 * Chooses rooms for expansion and sends creeps there.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const ExpandProcess = function (params, data) {
	Process.call(this, params, data);

	if (!Memory.strategy) {
		Memory.strategy = {};
	}

	if (!Memory.strategy.expand) {
		Memory.strategy.expand = {};
	}

	this.memory = Memory.strategy.expand;
};

ExpandProcess.prototype = Object.create(Process.prototype);

/**
 * Sends a squad for expanding to a new room if GCL and CPU allow.
 */
ExpandProcess.prototype.run = function () {
	// We probably can't expect to expand earlier than 100 ticks into the game.
	if (!stats.getStat('cpu_total', 1000)) return;

	const ownedRooms = _.size(_.filter(Game.rooms, room => room.isMine()));
	const harvestRooms = Memory.strategy.remoteHarvesting ? Memory.strategy.remoteHarvesting.currentCount : 0;

	// If we have many rooms with remote harvesting, be a bit more lenient
	// on CPU cap for claiming a new room. Remote harvesting can always be
	// dialed back to the most efficient rooms to save CPU.
	const cpuLimit = harvestRooms / (ownedRooms + 1) < 2 ? 0.8 : 1;

	const hasFreeControlLevels = ownedRooms < Game.gcl.level;
	const shortTermCpuUsage = stats.getStat('cpu_total', 1000) / Game.cpu.limit;
	const longTermCpuUsage = stats.getStat('cpu_total', 10000) ? stats.getStat('cpu_total', 10000) / Game.cpu.limit : shortTermCpuUsage;

	const canExpand = hasFreeControlLevels &&
		shortTermCpuUsage < cpuLimit &&
		longTermCpuUsage < cpuLimit;

	Memory.hivemind.canExpand = false;
	if (!this.memory.currentTarget && canExpand) {
		Memory.hivemind.canExpand = true;
		this.chooseNewExpansionTarget();
	}

	this.manageCurrentExpansion();

	// Check if we could benefit from giving up a room to expand to a better one.
	if (shortTermCpuUsage > cpuLimit && longTermCpuUsage > cpuLimit) {
		// this.abandonWeakRoom();
	}

	this.manageEvacuation();
};

/**
 * Chooses a new target room to expand to.
 */
ExpandProcess.prototype.chooseNewExpansionTarget = function () {
	// Choose a room to expand to.
	// @todo Handle cases where expansion to a target is not reasonable, like it being taken by somebody else, path not being safe, etc.
	let bestTarget = null;
	for (const info of _.values(Memory.strategy.roomList)) {
		if (!info.expansionScore || info.expansionScore <= 0) continue;
		if (bestTarget && bestTarget.expansionScore >= info.expansionScore) continue;
		if (Game.rooms[info.roomName] && Game.rooms[info.roomName].isMine()) continue;

		// Don't try to expand to a room that can't be reached safely.
		const bestSpawn = this.findClosestSpawn(info.roomName);
		if (!bestSpawn) continue;

		info.spawnRoom = bestSpawn;

		bestTarget = info;
	}

	if (bestTarget) {
		this.startExpansion(bestTarget);
	}
};

/**
 * Starts expanding to a given room.
 *
 * @param {object} roomInfo
 *   Scout information of the room to expand to.
 */
ExpandProcess.prototype.startExpansion = function (roomInfo) {
	this.memory.currentTarget = roomInfo;

	// Spawn expansion squad at origin.
	const squad = new Squad('expand');
	squad.setSpawn(roomInfo.spawnRoom);

	// Sent to target room.
	squad.setTarget(new RoomPosition(25, 25, roomInfo.roomName));

	// @todo Place flags to guide squad through safe rooms and make pathfinding easier.
	squad.clearUnits();
	squad.setUnitCount('brawler', 1);
	squad.setUnitCount('singleClaim', 1);
	squad.setUnitCount('builder', 2);
	squad.setPath(null);
	this.memory.started = Game.time;

	Game.notify('🏴 Started expanding to ' + roomInfo.roomName);
};

/**
 * Manages getting an expansion up and running.
 */
ExpandProcess.prototype.manageCurrentExpansion = function () {
	if (!this.memory.currentTarget) return;

	this.manageExpansionSupport();

	const info = this.memory.currentTarget;
	const squad = new Squad('expand');

	this.checkAccessPath();

	if (Game.rooms[info.roomName]) {
		// @todo If path to controller is blocked, send dismantlers to dismantle
		// blocking buildings, or construct a tunnel to the controller.

		const room = Game.rooms[info.roomName];
		squad.setTarget(room.controller.pos);

		if (room.controller.my) {
			if (!this.memory.claimed) {
				// Remove claimer from composition once room has been claimed.
				this.memory.claimed = Game.time;
				squad.setUnitCount('singleClaim', 0);
			}

			if (room.controller.level > 3 && room.storage) {
				this.stopExpansion();
				return;
			}
		}
		else {
			this.checkClaimPath();
		}
	}

	// @todo Abort if claiming takes too long and we don't have anything
	// to dismantle in the way of the controller.

	// If a lot of time has passed, let the room fend for itself anyways,
	// either it will be lost or fix itself.
	if (Game.time - this.memory.claimed > 50 * CREEP_LIFE_TIME) {
		this.stopExpansion();
	}
};

/**
 * Stops current expansion plans by disbanding all related squads.
 */
ExpandProcess.prototype.stopExpansion = function () {
	const roomName = this.memory.currentTarget.roomName;
	const squad = new Squad('expand');
	squad.disband();

	_.each(Game.squads, (squad, squadName) => {
		if (squadName.startsWith('expandSupport.' + roomName)) {
			squad.disband();
		}
	});

	Memory.strategy.expand = {};
	this.memory = Memory.strategy.expand;
};

/**
 * Sends extra builders from rooms in range so the room is self-sufficient sooner.
 */
ExpandProcess.prototype.manageExpansionSupport = function () {
	const info = this.memory.currentTarget;
	if (!info) return;

	const activeSquads = {};

	// @todo Start with closest rooms first.
	_.each(Game.rooms, room => {
		// 5 Support squads max.
		if (_.size(activeSquads) >= 5) return false;

		if (!room.isMine() || room.controller.level < 4) return;
		if (room.name === info.spawnRoom || room.name === info.roomName) return;
		if (Game.map.getRoomLinearDistance(room.name, info.roomName) > 10) return;
		if (room.getStoredEnergy() < 50000) return;

		const path = room.calculateRoomPath(info.roomName);
		if (!path || path.length > 15) return;

		const squadName = 'expandSupport.' + info.roomName + '.' + room.name;
		const supportSquad = new Squad(squadName);
		supportSquad.setSpawn(room.name);
		supportSquad.setTarget(new RoomPosition(25, 25, info.roomName));
		supportSquad.clearUnits();
		supportSquad.setUnitCount('builder', 1);
		// Sometimes add a claim creep if main squad has problems claiming the room.
		if (Math.random() < 0.05 && !this.memory.claimed) {
			supportSquad.setUnitCount('singleClaim', 1);
		}

		supportSquad.setPath(null);

		activeSquads[squadName] = true;
	});

	// Remove support squads from older rooms.
	// @todo This should no longer be necessary when the code in stopExpansion
	// works reliably.
	_.each(Game.squads, (squad, squadName) => {
		if (squadName.startsWith('expandSupport.') && !activeSquads[squadName]) {
			squad.disband();
		}
	});
};

/**
 * Checks if creeps can reach the room's controller, builds tunnels otherwise.
 */
ExpandProcess.prototype.checkClaimPath = function () {
	const info = this.memory.currentTarget;
	if (!info) return;

	const room = Game.rooms[info.roomName];
	const creeps = room.find(FIND_MY_CREEPS);

	const matrix = new PathFinder.CostMatrix();
	const terrain = new Room.Terrain(info.roomName);

	for (let x = 0; x < 50; x++) {
		for (let y = 0; y < 50; y++) {
			if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
				matrix.set(x, y, 255);
			}
			else {
				matrix.set(x, y, 1);
			}
		}
	}

	const roads = room.find(FIND_STRUCTURES, {
		filter: s => s.structureType === STRUCTURE_ROAD,
	});
	for (const road of roads) {
		matrix.set(road.pos.x, road.pos.y, 255);
	}

	// Treat road sites as walkable so we don't calculate multiple tunnel paths.
	const roadSites = room.find(FIND_CONSTRUCTION_SITES, {
		filter: s => s.structureType === STRUCTURE_ROAD,
	});
	for (const site of roadSites) {
		matrix.set(site.pos.x, site.pos.y, 255);
	}

	const structures = room.find(FIND_STRUCTURES, {
		filter: s => OBSTACLE_OBJECT_TYPES.indexOf(s.structureType) > -1 || (s.structureType === STRUCTURE_RAMPART && !s.my),
	});
	for (const structure of structures) {
		matrix.set(structure.pos.x, structure.pos.y, 255);
	}

	for (const creep of creeps) {
		const path = PathFinder.search(creep.pos, [{pos: room.controller.pos, range: 1}], {
			maxRooms: 1,
			plainCost: 1,
			swampCost: 1,
			roomCallback: roomName => {
				if (room.name !== roomName) return false;
				return matrix;
			},
		});

		// If creep can reach controller, everything is fine.
		if (!path.incomplete) break;

		// Find a new path that is allowed to go through walls, for
		// us to build tunnels.
		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
					matrix.set(x, y, 50);
				}
			}
		}

		const tunnelPath = PathFinder.search(creep.pos, [{pos: room.controller.pos, range: 1}], {
			maxRooms: 1,
			plainCost: 1,
			swampCost: 1,
			roomCallback: roomName => {
				if (room.name !== roomName) return false;
				return matrix;
			},
		});

		if (tunnelPath.incomplete) {
			// @todo Abort expansion or dismantle structures?
		}
		else {
			// Build tunnels.
			for (const pos of tunnelPath.path) {
				if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) {
					pos.createConstructionSite(STRUCTURE_ROAD);
				}
			}

			// One path is enough.
			break;
		}
	}
};

/**
 * Checks if there is a safe path to the current expansion for spawned creeps.
 */
ExpandProcess.prototype.checkAccessPath = function () {
	const info = this.memory.currentTarget;
	if (!info) return;

	const originRoom = Game.rooms[info.spawnRoom];
	if (originRoom) {
		const path = originRoom.calculateRoomPath(info.roomName);
		if (!path || path.length > 10) {
			// Path is too long, claimers might not even reach.
			if (!this.memory.pathBlocked) {
				this.memory.pathBlocked = Game.time;
			}
		}
		else {
			// Everything is fine (again).
			delete this.memory.pathBlocked;
		}
	}

	if (!originRoom || (this.memory.pathBlocked && Game.time - this.memory.pathBlocked > 5 * CREEP_LIFE_TIME)) {
		const newOrigin = this.findClosestSpawn(info.roomName);
		const squad = new Squad('expand');
		if (newOrigin) {
			info.spawnRoom = newOrigin;
			squad.setSpawn(newOrigin);
		}
		else {
			// No good spawn location available. Stop expanding, choose new target later.
			this.stopExpansion();
		}
	}
};

/**
 * Finds the closest valid spawn location for an expansion.
 *
 * @param {string} targetRoom
 *   Name of the room we're expanding to.
 *
 * @return {string}
 *   Name of the room to spawn from.
 */
ExpandProcess.prototype.findClosestSpawn = function (targetRoom) {
	let bestRoom = null;
	let bestLength = 0;
	_.each(Game.rooms, room => {
		if (!room.isMine() || room.controller.level < 5) return;
		if (room.name === targetRoom) return;
		if (Game.map.getRoomLinearDistance(room.name, targetRoom) > 10) return;

		const path = room.calculateRoomPath(targetRoom);
		if (!path || path.length > 10) return;

		if (!bestRoom || bestLength > path.length) {
			bestRoom = room;
			bestLength = path.length;
		}
	});

	return bestRoom && bestRoom.name;
};

/**
 * Decides if it's worth giving up a weak room in favor of a new expansion.
 */
ExpandProcess.prototype.abandonWeakRoom = function () {
	// Only choose a new target if we aren't already relocating.
	if (this.memory.evacuatingRoom) return;

	// @todo Take into account better expansions on other shards.
	// We expect a minimal gain from giving up a room.
	const shardMemory = interShard.getLocalMemory();
	if (!shardMemory.info) return;
	if (shardMemory.info.ownedRooms && shardMemory.info.ownedRooms < 2) return;
	if (!shardMemory.info.rooms) return;
	if (!shardMemory.info.rooms.bestExpansion) return;
	if (!shardMemory.info.rooms.worstRoom) return;
	if (shardMemory.info.rooms.bestExpansion.score - shardMemory.info.rooms.worstRoom.score < 0.5) return;

	const roomName = shardMemory.info.rooms.worstRoom.name;
	if (!Game.rooms[roomName] || !Game.rooms[roomName].isMine()) return;

	Game.rooms[roomName].setEvacuating(true);
	this.memory.evacuatingRoom = {
		name: roomName,
	};
	Game.notify('💀 Evacuating ' + roomName + ' to free up CPU cycles for expanding. Possible Target: ' + shardMemory.info.rooms.bestExpansion.name);
};

/**
 * Manages the room we are currently abandoning.
 */
ExpandProcess.prototype.manageEvacuation = function () {
	if (!this.memory.evacuatingRoom) return;

	const roomName = this.memory.evacuatingRoom.name;
	const room = Game.rooms[roomName];
	if (!room || !room.isMine()) {
		// We don't own this room anymore for some reason. Guess we're done.
		if (!this.memory.evacuatingRoom.cooldown) {
			// Start a cooldown timer of about 5000 ticks before considering
			// abandoning more (enough for creeps to despawn and CPU to normalize).
			this.memory.evacuatingRoom.cooldown = Game.time + 5000;
			return;
		}

		if (Game.time < this.memory.evacuatingRoom.cooldown) return;

		delete this.memory.evacuatingRoom;
		return;
	}

	// Storage needs to be emptied.
	if (room.storage && room.storage.store.getUsedCapacity() > 0) return;

	// Destroy nuker for some extra resources.
	// Make sure terminal is somewhat empty beforehand.
	if (room.terminal && room.terminal.store.getUsedCapacity() > 100000) return;
	if (room.nuker) room.nuker.destroy();

	// Terminal needs to be mostly empty and contain mostly energy.
	if (room.terminal && room.terminal.store.getUsedCapacity() > 10000) return;
	if (room.terminal && room.terminal.store.getUsedCapacity() > 0 && room.terminal.store.energy / room.terminal.store.getUsedCapacity() < 0.8) return;

	// Alright, this is it, flipping the switch!
	room.controller.unclaim();
	_.each(
		_.filter(room.find(FIND_MY_CREEPS), creep => creep.memory.singleRoom === room.name),
		creep => creep.suicide()
	);
};

module.exports = ExpandProcess;
