'use strict';

/* global hivemind RoomPosition OBSERVER_RANGE SOURCE_ENERGY_CAPACITY */

const interShard = require('./intershard');
const PathManager = require('./remote-path-manager');
const Process = require('./process');
const utilities = require('./utilities');

const preserveExpansionReasons = false;

/**
 * Decides room priorities for scouting, harvesting and expansion.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const ScoutProcess = function (params, data) {
	Process.call(this, params, data);

	this.pathManager = new PathManager();

	if (!Memory.strategy) {
		Memory.strategy = {};
	}
};

ScoutProcess.prototype = Object.create(Process.prototype);

/**
 * Calculates all rooms' priorities.
 *
 * This will happen in cycles to reduce cpu usage for a single tick.
 */
ScoutProcess.prototype.run = function () {
	// @todo Clean old entries from Memory.strategy._expansionScoreCache.

	Memory.strategy.roomList = this.generateScoutTargets();
	this.generateMineralStatus();

	const maxCpuUsage = hivemind.settings.get('maxRoomPrioritizationCpuPerTick');
	const startTime = Game.cpu.getUsed();

	// Add data to scout list for creating priorities.
	let allDone = true;
	let checkedCount = 0;
	if (!Memory.strategy.roomListProgress) Memory.strategy.roomListProgress = [];
	for (const roomName of _.keys(Memory.strategy.roomList)) {
		// Ignore rooms we already checked recently.
		if (Memory.strategy.roomListProgress.indexOf(roomName) > -1) continue;

		this.calculateRoomPriorities(roomName);
		Memory.strategy.roomListProgress.push(roomName);
		checkedCount++;

		if (Game.cpu.getUsed() - startTime > maxCpuUsage) {
			allDone = false;
			const numRooms = _.size(Memory.strategy.roomList);
			const progress = Memory.strategy.roomListProgress.length / numRooms;
			hivemind.log('strategy').debug('Terminated room prioritization after checking', checkedCount, 'of', numRooms, 'rooms (', (progress * 100).toPrecision(3) + '%', 'done).');
			break;
		}
	}

	if (allDone) {
		// Restart prioritizing rooms on the next run.
		delete Memory.strategy.roomListProgress;
	}
};

/**
 * Calculates scout, harvest and expand priotities for a room.
 *
 * @param {string} roomName
 *   Name of the room for which to calculate priorities.
 */
ScoutProcess.prototype.calculateRoomPriorities = function (roomName) {
	const roomIntel = hivemind.roomIntel(roomName);
	const info = Memory.strategy.roomList[roomName];

	info.roomName = roomName;
	info.scoutPriority = 0;
	info.expansionScore = 0;
	info.harvestPriority = 0;

	const timeSinceLastScan = roomIntel.getAge();

	if (info.range === 0 && roomIntel.isClaimable()) {
		// Add expansion score for later reference.
		const expansionInfo = this.calculateExpansionScore(roomName);
		info.expansionScore = expansionInfo.score;
		info.expansionReasons = expansionInfo.reasons;
	}

	if (info.range > 0 && info.range <= (Memory.hivemind.maxScoutDistance || 7)) {
		if (timeSinceLastScan > hivemind.settings.get('roomScoutInterval')) {
			info.scoutPriority = 1;
		}

		if (roomIntel.memory.lastScan > 0 && roomIntel.isClaimable() && (!roomIntel.isClaimed() || (roomIntel.memory.reservation && roomIntel.memory.reservation.username === 'Invader'))) {
			info.harvestPriority = this.calculateHarvestScore(roomName);

			// Check if we could reasonably expand to this room.
			const expansionInfo = this.calculateExpansionScore(roomName);
			info.expansionScore = expansionInfo.score;
			info.expansionReasons = expansionInfo.reasons;
		}
	}
	// @todo For higher ranges (7-10), only scout if we have memory to spare.

	if (info.observer && info.range <= 6 && (/^[EW]\d*0[NS]\d+$/.test(roomName) || /^[EW]\d+[NS]\d*0$/.test(roomName)) && timeSinceLastScan > hivemind.settings.get('highwayScoutInterval')) {
		// Corridor rooms get scouted more often to look for power banks.
		info.scoutPriority = 2;
	}

	if (info.scoutPriority > 0 && info.observer && info.range <= (Memory.hivemind.maxScoutDistance || 7)) {
		// Only observe if last Scan was longer ago than intel manager delay,
		// so we don't get stuck scanning the same room for some reason.
		if (timeSinceLastScan > hivemind.settings.get('roomIntelCacheDuration')) {
			// No need to manually scout rooms in range of an observer.
			info.scoutPriority = 0.5;

			// Let observer scout one room per run at maximum.
			// @todo Move this to structure management so we can scan one open room per tick.
			const observer = Game.getObjectById(info.observer);
			if (observer && !observer.hasScouted) {
				observer.observeRoom(roomName);
				observer.hasScouted = true;
			}
			else {
				if (!Memory.rooms[info.observerRoom].observeTargets) {
					Memory.rooms[info.observerRoom].observeTargets = [];
				}

				Memory.rooms[info.observerRoom].observeTargets.push(roomName);
			}
		}
	}
};

/**
 * Determines how worthwile a room is for remote mining.
 *
 * @param {string} roomName
 *   Name of the room for which to calculate priorities.
 *
 * @return {number}
 *   Harvest score for this room.
 */
ScoutProcess.prototype.calculateHarvestScore = function (roomName) {
	const info = Memory.strategy.roomList[roomName];

	if (!info.safePath) return 0;
	if (info.range === 0 || info.range > hivemind.settings.get('maxRemoteMineRoomDistance')) return 0;

	let income = -2000; // Flat cost for room reservation
	let pathLength = 0;
	const sourcePositions = hivemind.roomIntel(roomName).getSourcePositions();
	for (const pos of sourcePositions) {
		const path = this.pathManager.getPathFor(new RoomPosition(pos.x, pos.y, roomName));
		if (!path) continue;

		income += SOURCE_ENERGY_CAPACITY;
		pathLength += path.length;
	}

	// @todo Add score if this is a safe room (that will be reserved
	// anyways and can't be attacked).

	if (pathLength <= 0) return 0;
	return income / pathLength;
};

/**
 * Determines how worthwile a room is for expanding.
 *
 * @param {string} roomName
 *   Name of the room for which to calculate priorities.
 *
 * @return {number}
 *   Expansion score for this room.
 */
ScoutProcess.prototype.calculateExpansionScore = function (roomName) {
	const result = {
		score: 0,
		reasons: {},
		addScore(amount, reason) {
			if (amount === 0) return;

			this.score += amount;
			this.reasons[reason] = amount;
		},
	};

	if (this.getExpansionScoreFromCache(roomName, result)) {
		return result;
	}

	// Can't expand to closed rooms.
	if (Game.map.getRoomStatus(roomName).status === 'closed') {
		this.setExpansionScoreCache(roomName, result);
		return result;
	}

	const roomIntel = hivemind.roomIntel(roomName);

	// More sources is better.
	result.addScore(roomIntel.getSourcePositions().length, 'numSources');

	// Having a mineral source is good.
	const isMyRoom = Game.rooms[roomName] && Game.rooms[roomName].isMine();
	if (roomIntel.getMineralType()) {
		// In our own rooms, calculate the score this has gotten us.
		const mineralGain = isMyRoom ? 0 : 1;
		result.addScore(1 / ((this.mineralCount[roomIntel.getMineralType()] || 0) + mineralGain), 'numMinerals');
	}

	// Add score for harvest room sources.
	const exits = roomIntel.getExits();
	let hasHighwayExit = false;
	for (const adjacentRoom of _.values(exits)) {
		result.addScore(this.getHarvestRoomScore(adjacentRoom), 'harvest' + adjacentRoom);

		if (adjacentRoom.endsWith('0') || adjacentRoom.substr(2).startsWith('0')) {
			hasHighwayExit = true;
		}
	}

	if (hasHighwayExit) {
		result.addScore(hivemind.settings.get('expansionScoreBonusHighwayExit'), 'highwayExit');
	}

	// Check if expanding here creates a safe direction for another of our rooms.
	for (const otherRoom of _.values(Game.rooms)) {
		if (!otherRoom.isMine()) continue;
		if (otherRoom.name === roomName) continue;

		const roomDistance = Game.map.getRoomLinearDistance(roomName, otherRoom.name);
		if (roomDistance > 3) continue;

		const otherRoomIntel = hivemind.roomIntel(otherRoom.name);
		const normalSafety = otherRoomIntel.calculateAdjacentRoomSafety();
		const adjustedSafety = otherRoomIntel.calculateAdjacentRoomSafety(isMyRoom ? {unsafe: [roomName]} : {safe: [roomName]});

		// If after expanding there are more safe directions, improve score.
		const newSafeExits = Math.abs(_.sum(adjustedSafety.directions) - _.sum(normalSafety.directions));
		result.addScore(newSafeExits * 0.25, 'newSafeExits' + otherRoom.name);
		// Also, there will be less exit tiles to cover.
		const otherRoomExits = otherRoomIntel.getExits();
		const exitRatio = newSafeExits / _.size(otherRoomExits);
		result.addScore(otherRoomIntel.countTiles('exit') * 0.005 * exitRatio, 'exitTiles' + otherRoom.name);

		if (roomDistance > 2) continue;
		// Check if we need to share adjacent harvest rooms.
		for (const adjacentRoom of _.values(otherRoomExits)) {
			if (adjacentRoom === roomName) result.addScore(-this.getHarvestRoomScore(adjacentRoom), 'doubleUse' + adjacentRoom);
			for (const j in exits) {
				if (exits[j] === adjacentRoom) result.addScore(-this.getHarvestRoomScore(adjacentRoom), 'doubleUse' + adjacentRoom);
			}
		}

		if (roomDistance > 1) continue;

		if (_.values(exits).indexOf(otherRoom.name) !== -1) {
			// If we're direct neighbors, that also means we can't remote harvest
			// after expanding if there is a connecting exit.
			result.addScore(-this.getHarvestRoomScore(roomName), 'blockHarvest' + otherRoom.name);
		}
	}

	// Having fewer exit sides is good.
	// Having dead ends / safe rooms nearby is similarly good.
	const safety = roomIntel.calculateAdjacentRoomSafety();
	result.addScore(_.sum(safety.directions) * 0.25, 'safeExits');

	// Having fewer exit tiles is good. Safe exits reduce the number of tiles
	// we need to cover.
	// @todo We could gather exact amounts per direction in intel.
	const unsafeRatio = (4 - _.sum(safety.directions)) / _.size(exits);
	result.addScore(1 - (roomIntel.countTiles('exit') * 0.005 * unsafeRatio), 'exitTiles');
	// Having lots of open space is good (easier room layout).
	result.addScore(0.5 - (roomIntel.countTiles('wall') * 0.0002), 'wallTiles');
	// Having few swamp tiles is good (less cost for road maintenance, easier setup).
	result.addScore(0.25 - (roomIntel.countTiles('swamp') * 0.0001), 'swampTiles');

	this.setExpansionScoreCache(roomName, result);

	// @todo Prefer rooms with minerals we have little sources of.
	return result;
};

/**
 * Caches calculated expansion score for a room.
 *
 * @param {String} roomName
 *   Name of the room to cache data for.
 * @param {object} result
 *   The result of the expansion score calculation.
 */
ScoutProcess.prototype.setExpansionScoreCache = function (roomName, result) {
	if (!Memory.strategy._expansionScoreCache) Memory.strategy._expansionScoreCache = {};

	// Preserve expansion score reasons if needed.
	const cacheValue = [result.score, Game.time];
	if (preserveExpansionReasons) {
		cacheValue.push(result.reasons);
	}

	Memory.strategy._expansionScoreCache[roomName] = cacheValue;
};

/**
 * Gets calculated expansion score for a room from cache.
 *
 * @param {String} roomName
 *   Name of the room to get data for.
 * @param {object} result
 *   The result of the expansion score calculation to add score for.
 *
 * @return {boolean}
 *   True if a cached score was found, false if no score is in cache or it it
 *   stale.
 */
ScoutProcess.prototype.getExpansionScoreFromCache = function (roomName, result) {
	if (!Memory.strategy._expansionScoreCache) return false;
	if (!Memory.strategy._expansionScoreCache[roomName]) return false;
	if (hivemind.hasIntervalPassed(hivemind.settings.get('expansionScoreCacheDuration'), Memory.strategy._expansionScoreCache[roomName][1])) return false;

	result.addScore(Memory.strategy._expansionScoreCache[roomName][0], 'fromCache');
	if (Memory.strategy._expansionScoreCache[roomName][2]) {
		result.reasons = Memory.strategy._expansionScoreCache[roomName][2];
	}

	return true;
};

/**
 * Calculate value of adjacent harvest rooms for expansion purposes.
 *
 * @param {string} roomName
 *   Name of the room for which to calculate score.
 *
 * @return {number}
 *   Harvest score for this room.
 */
ScoutProcess.prototype.getHarvestRoomScore = function (roomName) {
	const roomIntel = hivemind.roomIntel(roomName);

	// We don't care about rooms without controllers.
	// @todo Once automated, we might care for exploiting source keeper rooms.
	if (!roomIntel.isClaimable()) return 0;

	// Try not to expand too close to other players.
	if (roomIntel.isOwned() && roomIntel.memory.owner !== 'Invader') return -0.5;

	// Can't remote harvest from my own room.
	if (Game.rooms[roomName] && Game.rooms[roomName].isMine()) return 0;

	let sourceFactor = 0.25;
	// If another player has reserved the adjacent room, we can't profit all that well.
	if (roomIntel.isClaimed() && roomIntel.memory.reservation.username !== 'Invader') sourceFactor = 0.1;

	// @todo factor in path length to sources.
	return roomIntel.getSourcePositions().length * sourceFactor;
};

/**
 * Generates a list of rooms originating from owned rooms.
 *
 * @return {object}
 *   Room info objects keyed by room name.
 */
ScoutProcess.prototype.generateScoutTargets = function () {
	const roomList = Memory.strategy.roomList || {};

	const openList = this.getScoutOrigins();
	const closedList = {};

	this.findObservers();

	// Flood fill from own rooms and add rooms we need intel of.
	while (_.size(openList) > 0) {
		const nextRoom = this.getNextRoomCandidate(openList);

		if (!nextRoom) break;

		this.addAdjacentRooms(nextRoom, openList, closedList);
		const info = openList[nextRoom];
		delete openList[nextRoom];
		const updated = closedList[nextRoom];
		closedList[nextRoom] = true;

		// Add current room as a candidate for scouting.
		if (!roomList[nextRoom] || roomList[nextRoom].range > info.range) {
			const observer = this.getClosestObserver(nextRoom);

			roomList[nextRoom] = {
				range: info.range,
				origin: info.origin,
				observer: observer && observer.id,
				observerRoom: observer && observer.pos.roomName,
				safePath: info.safePath,
			};
		}
		else if (!updated) {
			const observer = this.getClosestObserver(nextRoom);
			roomList[nextRoom].observer = observer && observer.id;
			roomList[nextRoom].observerRoom = observer && observer.pos.roomName;
		}
	}

	return roomList;
};

/**
 * Generates a list of rooms that can serve as a starting point for scouting.
 *
 * @return {object}
 *   A list of rooms info stubs, keyed by room name.
 */
ScoutProcess.prototype.getScoutOrigins = function () {
	const openList = {};

	// Starting point for scouting operations are owned rooms.
	_.each(Game.rooms, room => {
		if (!room.isMine()) return;

		openList[room.name] = {
			range: 0,
			origin: room.name,
			safePath: true,
		};
	});

	if (_.size(openList) === 0) {
		// Add any room with a portal as a scout origin if we have no room in this shard.
		const memory = interShard.getLocalMemory();
		_.each(memory.portals, portals => {
			_.each(portals, (portalInfo, portalPosition) => {
				const pos = utilities.decodePosition(portalPosition);
				if (!pos) return;

				openList[pos.roomName] = {
					range: 0,
					origin: pos.roomName,
					safePath: true,
				};
			});
		});
	}

	return openList;
};

/**
 * Generates a list of observer structures keyed by room name.
 */
ScoutProcess.prototype.findObservers = function () {
	this.observers = [];
	_.each(Game.rooms, room => {
		if (!room.isMine() || !room.observer) return;

		this.observers.push(room.observer);
	});
};

/**
 * Gets a the room from the list that has the lowest range from an origin point.
 *
 * @param {object} openList
 *   Remaining rooms to check, keyed by room name.
 *
 * @return {string}
 *   Name of the room to check next.
 */
ScoutProcess.prototype.getNextRoomCandidate = function (openList) {
	let minDist = null;
	let nextRoom = null;
	_.each(openList, (info, roomName) => {
		if (minDist === null || info.range < minDist) {
			minDist = info.range;
			nextRoom = roomName;
		}
	});

	return nextRoom;
};

/**
 * Adds unhandled adjacent rooms to open list.
 *
 * @param {string} roomName
 *   Room name on which to base this operation.
 * @param {object} openList
 *   List of rooms that still need searching, keyed by room name.
 * @param {object} closedList
 *   List of rooms that have been searched already.
 */
ScoutProcess.prototype.addAdjacentRooms = function (roomName, openList, closedList) {
	const info = openList[roomName];
	if (info.range >= (Memory.hivemind.maxScoutDistance || 7)) return;

	const exits = hivemind.roomIntel(roomName).getExits();
	for (const exit of _.values(exits)) {
		if (openList[exit] || closedList[exit]) continue;

		const roomIntel = hivemind.roomIntel(exit);
		const roomIsSafe = !roomIntel.isClaimed() || (roomIntel.memory.reservation && roomIntel.memory.reservation.username === 'Invader');

		openList[exit] = {
			range: info.range + 1,
			origin: info.origin,
			safePath: info.safePath && roomIsSafe,
		};
	}
};

/**
 * Finds the closest observer to a given room.
 *
 * @param {string} roomName
 *   Room name on which to base the search.
 *
 * @return {StructureObserver}
 *   The closest available observer.
 */
ScoutProcess.prototype.getClosestObserver = function (roomName) {
	let bestObserver = null;
	for (const observer of this.observers) {
		const roomDist = Game.map.getRoomLinearDistance(observer.room.name, roomName);
		if (roomDist > OBSERVER_RANGE) continue;

		if (!bestObserver || roomDist < Game.map.getRoomLinearDistance(bestObserver.room.name, roomName)) {
			bestObserver = observer;
		}
	}

	return bestObserver;
};

/**
 * Counts mineral sources in our empire.
 */
ScoutProcess.prototype.generateMineralStatus = function () {
	this.mineralCount = {};
	const mineralCount = this.mineralCount;
	_.each(Game.rooms, room => {
		if (!room.isMine()) return;
		const roomIntel = hivemind.roomIntel(room.name);
		const mineralType = roomIntel.getMineralType();

		mineralCount[mineralType] = (mineralCount[mineralType] || 0) + 1;
	});
};

module.exports = ScoutProcess;
