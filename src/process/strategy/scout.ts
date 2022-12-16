/* global RoomPosition OBSERVER_RANGE SOURCE_ENERGY_CAPACITY */

import Process from 'process/process';

import interShard from 'intershard';
import PathManager from 'remote-path-manager';
import {decodePosition} from 'utils/serialization';
import {getRoomIntel} from 'room-intel';

declare global {
	interface StructureObserver {
		hasScouted: boolean;
	}

	interface RoomMemory {
		observeTargets?: any;
	}

	interface Memory {
		strategy: StrategyMemory;
	}

	interface StrategyMemory {
		roomList?: Record<string, RoomListEntry>;
		roomListProgress?: string[]; // @todo Move to heap.
		_expansionScoreCache?: {
			[roomName: string]: [number, number] | [number, number, Record<string, number>];
		};
	}

	interface RoomListEntry {
		roomName: string;
		scoutPriority: number;
		expansionScore: number;
		harvestPriority: number;
		harvestActive?: boolean;
		range: number;
		expansionReasons?: unknown;
		observer?: Id<StructureObserver>;
		observerRoom?: string;
		safePath?: boolean;
		origin: string;
	}
}

const preserveExpansionReasons = false;

export default class ScoutProcess extends Process {
	pathManager: PathManager;
	observers;
	mineralCount;

	/**
	 * Decides room priorities for scouting, harvesting and expansion.
	 * @constructor
	 *
	 * @param {object} parameters
	 *   Options on how to run this process.
	 */
	constructor(parameters: ProcessParameters) {
		super(parameters);

		this.pathManager = new PathManager();

		if (!Memory.strategy) {
			Memory.strategy = {
				roomList: {},
				roomListProgress: [],
				_expansionScoreCache: {},
			};
		}
	}

	/**
	 * Calculates all rooms' priorities.
	 *
	 * This will happen in cycles to reduce cpu usage for a single tick.
	 */
	run() {
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
			if (Memory.strategy.roomListProgress.includes(roomName)) continue;

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
	}

	/**
	 * Calculates scout, harvest and expand priotities for a room.
	 *
	 * @param {string} roomName
	 *   Name of the room for which to calculate priorities.
	 */
	calculateRoomPriorities(roomName) {
		const roomIntel = getRoomIntel(roomName);
		const info = Memory.strategy.roomList[roomName];

		info.roomName = roomName;
		info.scoutPriority = 0;
		info.expansionScore = 0;
		info.harvestPriority = 0;

		// Clean up old memory artifacts.
		delete info.harvestActive;

		const timeSinceLastScan = roomIntel.getAge();

		if (info.range === 0 && roomIntel.isClaimable()) {
			// Add expansion score for later reference.
			const expansionInfo = this.calculateExpansionScore(roomName);
			info.expansionScore = expansionInfo.score;
			if (preserveExpansionReasons) {
				info.expansionReasons = expansionInfo.reasons;
			}
			else {
				delete info.expansionReasons;
			}
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
				const observer = Game.getObjectById<StructureObserver>(info.observer);
				if (observer) {
					if (!observer.hasScouted) {
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
				else if (Memory.rooms[info.observerRoom]) {
					delete Memory.rooms[info.observerRoom].observeTargets;
				}
			}
		}
	}

	/**
	 * Determines how worthwile a room is for remote mining.
	 *
	 * @param {string} roomName
	 *   Name of the room for which to calculate priorities.
	 *
	 * @return {number}
	 *   Harvest score for this room.
	 */
	calculateHarvestScore(roomName) {
		const info = Memory.strategy.roomList[roomName];

		if (!info.safePath) return 0;
		if (info.range === 0 || info.range > hivemind.settings.get('maxRemoteMineRoomDistance')) return 0;

		let income = -2000; // Flat cost for room reservation
		let pathLength = 0;
		const sourcePositions = getRoomIntel(roomName).getSourcePositions();
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
	}

	/**
	 * Determines how worthwile a room is for expanding.
	 *
	 * @param {string} roomName
	 *   Name of the room for which to calculate priorities.
	 *
	 * @return {number}
	 *   Expansion score for this room.
	 */
	calculateExpansionScore(roomName) {
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

		const roomIntel = getRoomIntel(roomName);

		// More sources is better.
		result.addScore(roomIntel.getSourcePositions().length, 'numSources');

		// Having a mineral source is good.
		// We prefer rooms with minerals of which we have few / no sources.
		const isMyRoom = Game.rooms[roomName] && Game.rooms[roomName].isMine();
		if (roomIntel.getMineralType()) {
			// In our own rooms, calculate the score this has gotten us.
			const mineralGain = isMyRoom ? 0 : 1;
			result.addScore(1 / ((this.mineralCount[roomIntel.getMineralType()] || 0) + mineralGain), 'numMinerals');
		}

		// Add score for harvest room sources.
		const exits = roomIntel.getExits();
		let hasHighwayExit = false;
		for (const adjacentRoom of _.values<string>(exits)) {
			result.addScore(this.getHarvestRoomScore(adjacentRoom), 'harvest' + adjacentRoom);

			if (adjacentRoom.endsWith('0') || adjacentRoom.slice(2).startsWith('0')) {
				hasHighwayExit = true;
			}
		}

		if (hasHighwayExit) {
			result.addScore(hivemind.settings.get('expansionScoreBonusHighwayExit'), 'highwayExit');
		}

		// Check if expanding here creates a safe direction for another of our rooms.
		for (const otherRoom of _.values<Room>(Game.rooms)) {
			if (!otherRoom.isMine()) continue;
			if (otherRoom.name === roomName) continue;

			const roomDistance = Game.map.getRoomLinearDistance(roomName, otherRoom.name);
			if (roomDistance > 3) continue;

			const otherRoomIntel = getRoomIntel(otherRoom.name);
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

			if (_.values(exits).includes(otherRoom.name)) {
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

		return result;
	}

	/**
	 * Caches calculated expansion score for a room.
	 *
	 * @param {String} roomName
	 *   Name of the room to cache data for.
	 * @param {object} result
	 *   The result of the expansion score calculation.
	 */
	setExpansionScoreCache(roomName: string, result: {score: number; reasons: Record<string, number>}) {
		if (!Memory.strategy._expansionScoreCache) Memory.strategy._expansionScoreCache = {};

		// Preserve expansion score reasons if needed.
		if (preserveExpansionReasons) {
			Memory.strategy._expansionScoreCache[roomName] = [result.score, Game.time, result.reasons];
		}
		else {
			Memory.strategy._expansionScoreCache[roomName] = [result.score, Game.time];
		}
	}

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
	getExpansionScoreFromCache(roomName, result) {
		if (!Memory.strategy._expansionScoreCache) return false;
		if (!Memory.strategy._expansionScoreCache[roomName]) return false;
		if (hivemind.hasIntervalPassed(hivemind.settings.get('expansionScoreCacheDuration'), Memory.strategy._expansionScoreCache[roomName][1])) return false;

		result.addScore(Memory.strategy._expansionScoreCache[roomName][0], 'fromCache');
		if (Memory.strategy._expansionScoreCache[roomName][2]) {
			result.reasons = Memory.strategy._expansionScoreCache[roomName][2];
		}

		return true;
	}

	/**
	 * Calculate value of adjacent harvest rooms for expansion purposes.
	 *
	 * @param {string} roomName
	 *   Name of the room for which to calculate score.
	 *
	 * @return {number}
	 *   Harvest score for this room.
	 */
	getHarvestRoomScore(roomName) {
		const roomIntel = getRoomIntel(roomName);

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
	}

	/**
	 * Generates a list of rooms originating from owned rooms.
	 *
	 * @return {object}
	 *   Room info objects keyed by room name.
	 */
	generateScoutTargets() {
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
			if (!roomList[nextRoom] || roomList[nextRoom].range > info.range || !Game.rooms[roomList[nextRoom].origin] || !Game.rooms[roomList[nextRoom].origin].isMine()) {
				const observer = this.getClosestObserver(nextRoom);

				roomList[nextRoom] = {
					roomName: nextRoom,
					range: info.range,
					origin: info.origin,
					safePath: info.safePath,
					harvestPriority: 0,
					expansionScore: 0,
					scoutPriority: 0,
				};

				if (observer) {
					roomList[nextRoom].observer = observer.id;
					roomList[nextRoom].observerRoom = observer.pos.roomName;
				}
			}
			else if (!updated) {
				const observer = this.getClosestObserver(nextRoom);
				if (observer) {
					roomList[nextRoom].observer = observer.id;
					roomList[nextRoom].observerRoom = observer.pos.roomName;
				}
				else {
					delete roomList[nextRoom].observer;
					delete roomList[nextRoom].observerRoom;
				}
			}
		}

		return roomList;
	}

	/**
	 * Generates a list of rooms that can serve as a starting point for scouting.
	 *
	 * @return {object}
	 *   A list of rooms info stubs, keyed by room name.
	 */
	getScoutOrigins() {
		const openList = {};

		// Starting point for scouting operations are owned rooms.
		for (const room of Game.myRooms) {
			openList[room.name] = {
				range: 0,
				origin: room.name,
				safePath: true,
			};
		}

		if (_.size(openList) === 0) {
			// Add any room with a portal as a scout origin if we have no room in this shard.
			const memory = interShard.getLocalMemory();
			_.each(memory.portals, portals => {
				_.each(portals, (portalInfo, portalPosition) => {
					const pos = decodePosition(portalPosition);
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
	}

	/**
	 * Generates a list of observer structures keyed by room name.
	 */
	findObservers() {
		this.observers = [];
		for (const room of Game.myRooms) {
			if (!room.observer) return;

			this.observers.push(room.observer);
		}
	}

	/**
	 * Gets a the room from the list that has the lowest range from an origin point.
	 *
	 * @param {object} openList
	 *   Remaining rooms to check, keyed by room name.
	 *
	 * @return {string}
	 *   Name of the room to check next.
	 */
	getNextRoomCandidate(openList) {
		let minDist = null;
		let nextRoom = null;
		_.each(openList, (info, roomName) => {
			if (minDist === null || info.range < minDist) {
				minDist = info.range;
				nextRoom = roomName;
			}
		});

		return nextRoom;
	}

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
	addAdjacentRooms(roomName, openList, closedList) {
		const info = openList[roomName];
		if (info.range >= (Memory.hivemind.maxScoutDistance || 7)) return;

		const exits = getRoomIntel(roomName).getExits();
		for (const exit of _.values<string>(exits)) {
			if (openList[exit] || closedList[exit]) continue;

			const roomIntel = getRoomIntel(exit);
			const roomIsSafe = !roomIntel.isClaimed() || (roomIntel.memory.reservation && roomIntel.memory.reservation.username === 'Invader');

			openList[exit] = {
				range: info.range + 1,
				origin: info.origin,
			};
			if (info.safePath && roomIsSafe) openList[exit].safePath = true;
		}
	}

	/**
	 * Finds the closest observer to a given room.
	 *
	 * @param {string} roomName
	 *   Room name on which to base the search.
	 *
	 * @return {StructureObserver}
	 *   The closest available observer.
	 */
	getClosestObserver(roomName) {
		let bestObserver = null;
		for (const observer of this.observers) {
			const roomDist = Game.map.getRoomLinearDistance(observer.room.name, roomName);
			if (roomDist > OBSERVER_RANGE) continue;

			if (!bestObserver || roomDist < Game.map.getRoomLinearDistance(bestObserver.room.name, roomName)) {
				bestObserver = observer;
			}
		}

		return bestObserver;
	}

	/**
	 * Counts mineral sources in our empire.
	 */
	generateMineralStatus() {
		this.mineralCount = {};
		const mineralCount = this.mineralCount;
		for (const room of Game.myRooms) {
			const roomIntel = getRoomIntel(room.name);
			const mineralType = roomIntel.getMineralType();

			mineralCount[mineralType] = (mineralCount[mineralType] || 0) + 1;
		}
	}
}
