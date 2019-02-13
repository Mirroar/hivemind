'use strict';

/* global hivemind RoomPosition OBSERVER_RANGE */

const Process = require('./process');
const utilities = require('./utilities');

const ScoutProcess = function (params, data) {
	Process.call(this, params, data);

	if (!Memory.strategy) {
		Memory.strategy = {};
	}
};

ScoutProcess.prototype = Object.create(Process.prototype);

ScoutProcess.prototype.run = function () {
	Memory.strategy.roomList = this.generateScoutTargets();
	this.generateMineralStatus();

	// Add data to scout list for creating priorities.
	for (const roomName in Memory.strategy.roomList) {
		this.calculateRoomPriorities(roomName);
	}
};

/**
 * Calculates scout, harvest and expand priotities for all known rooms.
 */
ScoutProcess.prototype.calculateRoomPriorities = function (roomName) {
	const roomList = Memory.strategy.roomList;
	const roomIntel = hivemind.roomIntel(roomName);

	const info = roomList[roomName];

	info.roomName = roomName;
	info.scoutPriority = 0;
	info.expansionScore = 0;
	info.harvestPriority = 0;

	const timeSinceLastScan = roomIntel.getAge();

	if (info.range > 0 && info.range <= (Memory.hivemind.maxScoutDistance || 7)) {
		if (timeSinceLastScan > 5000) {
			info.scoutPriority = 1;
		}
		else if (roomIntel.isClaimable() && !roomIntel.isClaimed()) {
			info.harvestPriority = this.calculateHarvestScore(roomName);

			// Check if we could reasonably expand to this room.
			const expansionInfo = this.calculateExpansionScore(roomName);
			info.expansionScore = expansionInfo.score;
			info.expansionReasons = expansionInfo.reasons;
		}
	}
	// @todo For higher ranges (7-10), only scout if we have memory to spare.

	if (info.observer && info.range <= 6 && (/^[EW]\d*0[NS]\d+$/.test(roomName) || /^[EW]\d+[NS]\d*0$/.test(roomName)) && timeSinceLastScan > 1000) {
		// Corridor rooms get scouted more often to look for power banks.
		info.scoutPriority = 2;
	}

	if (info.scoutPriority > 0 && info.observer) {
		// Only observe if last Scan was longer ago than intel manager delay,
		// so we don't get stuck scanning the same room for some reason.
		if (timeSinceLastScan > 500) {
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
 */
ScoutProcess.prototype.calculateHarvestScore = function (roomName) {
	const info = Memory.strategy.roomList[roomName];

	if (!info.safePath) return 0;
	if (info.range == 0 || info.range > 2) return 0;

	let income = -2000; // Flat cost for room reservation
	let pathLength = 0;
	const sourcePositions = hivemind.roomIntel(roomName).getSourcePositions();
	for (const i in sourcePositions) {
		income += 3000;
		pathLength += info.range * 50; // Flag path length if it has not been calculated yet.
		if (typeof sourcePositions[i] === 'object') {
			const sourcePos = new RoomPosition(sourcePositions[i].x, sourcePositions[i].y, roomName);
			utilities.precalculatePaths(Game.rooms[info.origin], sourcePos);

			if (Memory.rooms[info.origin].remoteHarvesting) {
				const harvestMemory = Memory.rooms[info.origin].remoteHarvesting[utilities.encodePosition(sourcePos)];
				if (harvestMemory && harvestMemory.cachedPath) {
					pathLength -= info.range * 50;
					pathLength += harvestMemory.cachedPath.path.length;
				}
			}
		}
	}

	// @todo Add score if this is a safe room (that will be reserved
	// anyways and can't be attacked).

	if (pathLength <= 0) return 0;
	return income / pathLength;
};

/**
 * Determines how worthwile a room is for expanding.
 */
ScoutProcess.prototype.calculateExpansionScore = function (roomName) {
	const result = {
		score: 0,
		reasons: {},
	};
	const roomIntel = hivemind.roomIntel(roomName);

	// More sources is better.
	this.addExpansionScore(result, roomIntel.getSourcePositions().length, 'numSources');

	// Having a mineral source is good.
	if (roomIntel.getMineralType()) {
		this.addExpansionScore(result, 1 / ((this.mineralCount[roomIntel.getMineralType()] || 0) + 1), 'numMinerals');
	}

	// Having fewer exit sides is good.
	// Having dead ends / safe rooms nearby is similarly good.
	const exits = roomIntel.getExits();
	const safety = roomIntel.calculateAdjacentRoomSafety();
	this.addExpansionScore(result, _.sum(safety.directions) * 0.25, 'safeExits');

	// Add score for harvest room sources.
	for (const i in exits) {
		const adjacentRoom = exits[i];
		this.addExpansionScore(result, this.getHarvestRoomScore(adjacentRoom), 'harvest' + adjacentRoom);
	}

	// Check if expanding here creates a safe direction for another of our rooms.
	for (const otherRoomName in Game.rooms) {
		const otherRoom = Game.rooms[otherRoomName];
		if (!otherRoom.controller || !otherRoom.controller.my) continue;

		const roomDistance = Game.map.getRoomLinearDistance(roomName, otherRoomName);
		if (roomDistance > 3) continue;

		const otherRoomIntel = hivemind.roomIntel(otherRoomName);
		const currentSafety = otherRoomIntel.calculateAdjacentRoomSafety();
		const adjustedSafety = otherRoomIntel.calculateAdjacentRoomSafety({safe: [roomName]});

		// If after expanding there are more safe directions, improve score.
		const newSafeExits = (_.sum(adjustedSafety.directions) - _.sum(currentSafety.directions));
		this.addExpansionScore(result, newSafeExits * 0.25, 'newSafeExits' + otherRoomName);
		// Also, there will be less exit tiles to cover.
		const otherRoomExits = otherRoomIntel.getExits();
		const exitRatio = newSafeExits / _.size(otherRoomExits);
		this.addExpansionScore(result, otherRoomIntel.countTiles('exit') * 0.005 * exitRatio, 'exitTiles' + otherRoomName);

		if (roomDistance > 2) continue;
		// Check if we need to share adjacent harvest rooms.
		for (const i in otherRoomExits) {
			const adjacentRoom = otherRoomExits[i];
			if (adjacentRoom === roomName) this.addExpansionScore(result, -this.getHarvestRoomScore(adjacentRoom), 'doubleUse' + adjacentRoom);
			for (const j in exits) {
				if (exits[j] === adjacentRoom) this.addExpansionScore(result, -this.getHarvestRoomScore(adjacentRoom), 'doubleUse' + adjacentRoom);
			}
		}
	}

	// Having fewer exit tiles is good. Safe exits reduce the number of tiles
	// we need to cover.
	// @todo We could gather exact amounts per direction in intel.
	const unsafeRatio = (4 - _.sum(safety.directions)) / _.size(exits);
	this.addExpansionScore(result, 1 - (roomIntel.countTiles('exit') * 0.005 * unsafeRatio), 'exitTiles');
	// Having lots of open space is good (easier room layout).
	this.addExpansionScore(result, 0.5 - (roomIntel.countTiles('wall') * 0.0002), 'wallTiles');
	// Having few swamp tiles is good (less cost for road maintenance, easier setup).
	this.addExpansionScore(result, 0.25 - (roomIntel.countTiles('swamp') * 0.0001), 'swampTiles');

	// @todo Prefer rooms with minerals we have little sources of.
	return result;
};

/**
 * Stores expansion priority score along with reasoning.
 */
ScoutProcess.prototype.addExpansionScore = function (result, amount, reason) {
	result.score += amount;
	result.reasons[reason] = amount;
};

/**
 * Calculate value of harvest rooms for expansion purposes.
 */
ScoutProcess.prototype.getHarvestRoomScore = function (roomName) {
	const roomIntel = hivemind.roomIntel(roomName);

	// We don't care about rooms without controllers.
	// @todo Once automated, we might care for exploiting source keeper rooms.
	if (!roomIntel.isClaimable()) return 0;

	// Try not to expand too close to other players.
	if (roomIntel.isOwned()) return -0.5;

	// Can't remote harvest from my own room.
	if (Game.rooms[roomName] && Game.rooms[roomName].controller && Game.rooms[roomName].controller.my) return 0;

	let sourceFactor = 0.25;
	// If another player has reserved the adjacent room, we can't profit all that well.
	if (roomIntel.isClaimed()) sourceFactor = 0.1;

	// @todo factor in path length to sources.
	return roomIntel.getSourcePositions().length * sourceFactor;
};

/**
 * Generates a list of rooms originating from owned rooms.
 */
ScoutProcess.prototype.generateScoutTargets = function () {
	const roomList = {};

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
	}

	return roomList;
};

/**
 * Generates a list of rooms that can serve as a starting point for scouting.
 */
ScoutProcess.prototype.getScoutOrigins = function () {
	const openList = {};

	// Starting point for scouting operations are owned rooms.
	for (const roomName in Game.rooms) {
		const room = Game.rooms[roomName];
		if (!room.controller || !room.controller.my) continue;

		openList[roomName] = {
			range: 0,
			origin: roomName,
			safePath: true,
		};
	}

	return openList;
};

/**
 * Generates a list of observer structures keyed by room name.
 */
ScoutProcess.prototype.findObservers = function () {
	this.observers = [];
	for (const roomName in Game.rooms) {
		const room = Game.rooms[roomName];
		if (!room.controller || !room.controller.my || !room.observer) continue;

		this.observers[roomName] = room.observer;
	}
};

/**
 * Gets a the room from the list that has the lowest range from an origin point.
 */
ScoutProcess.prototype.getNextRoomCandidate = function (openList) {
	let minDist = null;
	let nextRoom = null;
	for (const roomName in openList) {
		const info = openList[roomName];
		if (minDist === null || info.range < minDist) {
			minDist = info.range;
			nextRoom = roomName;
		}
	}

	return nextRoom;
};

/**
 * Adds unhandled adjacent rooms to open list.
 */
ScoutProcess.prototype.addAdjacentRooms = function (roomName, openList, closedList) {
	const info = openList[roomName];
	const exits = hivemind.roomIntel(roomName).getExits();
	for (const i in exits) {
		const exit = exits[i];
		if (openList[exit] || closedList[exit]) continue;

		const roomIsSafe = !hivemind.roomIntel(exit).isClaimed();

		openList[exit] = {
			range: info.range + 1,
			origin: info.origin,
			safePath: info.safePath && roomIsSafe,
		};
	}
};

/**
 * Finds the closest observer to a given room.
 */
ScoutProcess.prototype.getClosestObserver = function (roomName) {
	let observer = null;
	for (const observerRoom in this.observers) {
		const roomDist = Game.map.getRoomLinearDistance(observerRoom, roomName);
		if (roomDist <= OBSERVER_RANGE) {
			if (!observer || roomDist < Game.map.getRoomLinearDistance(observer.pos.roomName, roomName)) {
				observer = this.observers[observerRoom];
			}
		}
	}

	return observer;
};

ScoutProcess.prototype.generateMineralStatus = function () {
	this.mineralCount = {};
	const mineralCount = this.mineralCount;
	_.each(Game.rooms, room => {
		if (!room.controller || !room.controller.my) return;
		const roomIntel = hivemind.roomIntel(room.name);
		const mineralType = roomIntel.getMineralType();

		mineralCount[mineralType] = (mineralCount[mineralType] || 0) + 1;
	});
};

module.exports = ScoutProcess;
