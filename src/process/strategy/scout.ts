/* global RoomPosition OBSERVER_RANGE SOURCE_ENERGY_CAPACITY */

import container from 'utils/container';
import Process from 'process/process';
import hivemind from 'hivemind';
import interShard from 'intershard';
import PathManager from 'empire/remote-path-manager';
import RoomStatus from 'room/room-status';
import {decodePosition} from 'utils/serialization';
import {getRoomIntel} from 'room-intel';
import {isHighway} from 'utils/room-name';

declare global {
	interface StructureObserver {
		hasScouted: boolean;
	}

	interface RoomMemory {
		observeTargets?: string[];
	}

	interface Memory {
		strategy: StrategyMemory;
	}

	interface StrategyMemory {
		roomListProgress?: string[]; // @todo Move to heap.
	}
}

interface ScoutTarget {
	range: number;
	origin: string;
	safePath: boolean;
}

interface ExpansionScore {
	score: number;
	reasons: Record<string, number>;
	addScore: (score: number, reason: string) => void;
}

const expansionScoreCache: Record<string, [number, number] | [number, number, Record<string, number>]> = {};

export default class ScoutProcess extends Process {
	pathManager: PathManager;
	observers: StructureObserver[];
	mineralCount: Record<string, number>;
	roomStatus: RoomStatus;

	/**
	 * Decides room priorities for scouting, harvesting and expansion.
	 * @constructor
	 *
	 * @param {object} parameters
	 *   Options on how to run this process.
	 */
	constructor(parameters: ProcessParameters) {
		super(parameters);

		if (!Memory.strategy) {
			Memory.strategy = {
				roomListProgress: [],
			};
		}

		this.pathManager = new PathManager();
		this.roomStatus = container.get('RoomStatus');
	}

	/**
	 * Calculates all rooms' priorities.
	 *
	 * This will happen in cycles to reduce cpu usage for a single tick.
	 */
	run() {
		hivemind.log('strategy').info('Running scout process...');

		this.findObservers();
		this.generateScoutTargets();
		this.generateMineralStatus();

		const maxCpuUsage = hivemind.settings.get('maxRoomPrioritizationCpuPerTick');
		const startTime = Game.cpu.getUsed();

		// Add data to scout list for creating priorities.
		let allDone = true;
		let checkedCount = 0;
		if (!Memory.strategy.roomListProgress) Memory.strategy.roomListProgress = [];

		for (const roomName of this.roomStatus.getAllKnownRooms()) {
			// Ignore rooms we already checked recently.
			if (Memory.strategy.roomListProgress.includes(roomName)) continue;

			this.calculateRoomPriorities(roomName);
			Memory.strategy.roomListProgress.push(roomName);
			checkedCount++;

			if (Game.cpu.getUsed() - startTime > maxCpuUsage) {
				allDone = false;
				const roomCount = this.roomStatus.getAllKnownRooms().length;
				const progress = Memory.strategy.roomListProgress.length / roomCount;
				hivemind.log('strategy').debug('Terminated room prioritization after checking', checkedCount, 'of', roomCount, 'rooms (', (progress * 100).toPrecision(3) + '%', 'done).');

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
	calculateRoomPriorities(roomName: string) {
		this.roomStatus.resetScores(roomName);

		const roomIntel = getRoomIntel(roomName);
		const range = this.roomStatus.getDistanceToOrigin(roomName)
		if (range === 0 && roomIntel.isClaimable()) {
			// Add expansion score for later reference.
			const expansionInfo = this.calculateExpansionScore(roomName);
			this.roomStatus.setExpansionScore(roomName, expansionInfo.score, expansionInfo.reasons);
		}

		const timeSinceLastScan = roomIntel.getAge();
		if (range > 0 && range <= (Memory.hivemind.maxScoutDistance || 7)) {
			if (timeSinceLastScan > hivemind.settings.get('roomScoutInterval')) {
				this.roomStatus.setScoutPriority(roomName, 1);
			}

			if ((roomIntel.memory.lastScan || 0) > 0) {
				this.roomStatus.setHarvestPriority(roomName, this.calculateHarvestScore(roomName));

				// Check if we could reasonably expand to this room.
				const expansionInfo = this.calculateExpansionScore(roomName);
				this.roomStatus.setExpansionScore(roomName, expansionInfo.score, expansionInfo.reasons);
			}
		}
		// @todo For higher ranges (7-10), only scout if we have memory to spare.

		const observer = this.getClosestObserver(roomName);
		if (range <= 6 && (/^[EW]\d*0[NS]\d+$/.test(roomName) || /^[EW]\d+[NS]\d*0$/.test(roomName)) && timeSinceLastScan > hivemind.settings.get('highwayScoutInterval') && observer) {
			// Corridor rooms get scouted more often to look for power banks.
			this.roomStatus.setScoutPriority(roomName, 2);
		}

		if (
			this.roomStatus.getScoutPriority(roomName) > 0 && observer && range <= (Memory.hivemind.maxScoutDistance || 7)
			// Only observe if last Scan was longer ago than intel manager delay,
			// so we don't get stuck scanning the same room for some reason.
			&& timeSinceLastScan > hivemind.settings.get('roomIntelCacheDuration')
		) {
			// No need to manually scout rooms in range of an observer.
			this.roomStatus.setScoutPriority(roomName, 0.5);

			// Let observer scout one room per run at maximum.
			// @todo Move this to structure management so we can scan one open room per tick.
			if (!observer.hasScouted) {
				observer.observeRoom(roomName);
				observer.hasScouted = true;
				hivemind.log('intel', observer.pos.roomName).info('Observing', roomName);
			}
			else {
				if (!Memory.rooms[observer.pos.roomName].observeTargets) {
					Memory.rooms[observer.pos.roomName].observeTargets = [];
				}

				Memory.rooms[observer.pos.roomName].observeTargets.push(roomName);
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
	calculateHarvestScore(roomName: string) {
		const range = this.roomStatus.getDistanceToOrigin(roomName);
		if (range === 0 || range > hivemind.settings.get('maxRemoteMineRoomDistance')) return 0;
		if (Game.map.getRoomStatus(roomName).status === 'closed') return 0;

		const roomIntel = getRoomIntel(roomName);
		// @todo Calculate cost for room reservation instead of this flat estimation.
		let income = -2000;
		let sourceCapacity: number = SOURCE_ENERGY_CAPACITY;
		if (!roomIntel.isClaimable()) {
			// SK rooms don't need reservation. Instead we spawn SK killers,
			// which generate additional income for us.
			sourceCapacity = SOURCE_ENERGY_KEEPER_CAPACITY;
		}

		let pathLength = 0;
		const sourcePositions = roomIntel.getSourcePositions();
		for (const pos of sourcePositions) {
			const path = this.pathManager.getPathFor(new RoomPosition(pos.x, pos.y, roomName));
			if (!path) continue;

			income += sourceCapacity;
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
	calculateExpansionScore(roomName: string) {
		const result: ExpansionScore = {
			score: 0,
			reasons: {},
			addScore(amount: number, reason: string) {
				if (amount === 0) return;

				this.score += amount;
				this.reasons[reason] = (this.reasons[reason] || 0) + amount;
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
		if (!roomIntel.isClaimable()) {
			this.setExpansionScoreCache(roomName, result);
			return result;
		}

		// More sources is better.
		result.addScore((roomIntel.getSourcePositions().length * 2) - 2, 'numSources');

		// Having a mineral source is good.
		// We prefer rooms with minerals of which we have few / no sources.
		const isMyRoom = Game.rooms[roomName] && Game.rooms[roomName].isMine();
		for (const mineralType of roomIntel.getMineralTypes()) {
			// In our own rooms, calculate the score this has gotten us.
			const mineralGain = isMyRoom ? 0 : 1;
			result.addScore(1 / ((this.mineralCount[mineralType] || 0) + mineralGain), 'numMinerals');
		}

		// Add score for harvest room sources.
		const exits = roomIntel.getExits();
		let hasHighwayExit = false;
		const adjacentRoomInfluence: Record<string, number> = {};
		for (const adjacentRoom of _.values<string>(exits)) {
			adjacentRoomInfluence[adjacentRoom] = 1;

			if (adjacentRoom.endsWith('0') || adjacentRoom.slice(2).startsWith('0')) {
				hasHighwayExit = true;
			}

			const adjacentIntel = getRoomIntel(adjacentRoom);
			for (const range2Room of _.values<string>(adjacentIntel.getExits())) {
				adjacentRoomInfluence[range2Room] = 0.5;
			}
		}

		for (const adjacentRoom in adjacentRoomInfluence) {
			if (adjacentRoom === roomName) continue;

			const multiplier = adjacentRoomInfluence[adjacentRoom];
			result.addScore(multiplier * this.getHarvestRoomScore(adjacentRoom), 'harvest' + adjacentRoom);
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
			for (const adjacentRoom of _.values<string>(otherRoomExits)) {
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

		// Prefer rooms to be a certain range from each other.
		const distancesToRoom = _.map(_.filter(Game.myRooms, room => room.name !== roomName), room => Game.map.getRoomLinearDistance(room.name, roomName));
		if (distancesToRoom.length > 0) {
			const distanceToNextRoom = _.min(distancesToRoom);
			const minDist = hivemind.settings.get('expansionMinRoomDistance');
			const maxDist = hivemind.settings.get('expansionMaxRoomDistance');
			if (distanceToNextRoom < minDist) {
				result.addScore((distanceToNextRoom - minDist), 'tooClose');
			}

			if (distanceToNextRoom > maxDist) {
				result.addScore(-(distanceToNextRoom - maxDist), 'tooFar');
			}
		}

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
	setExpansionScoreCache(roomName: string, result: ExpansionScore) {
		expansionScoreCache[roomName] = [result.score, Game.time, result.reasons];
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
	getExpansionScoreFromCache(roomName: string, result: ExpansionScore) {
		if (!expansionScoreCache[roomName]) return false;
		if (hivemind.hasIntervalPassed(hivemind.settings.get('expansionScoreCacheDuration'), expansionScoreCache[roomName][1])) return false;

		result.addScore(expansionScoreCache[roomName][0], 'fromCache');
		result.reasons = expansionScoreCache[roomName][2];

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
	getHarvestRoomScore(roomName: string, forOwnedRoom = false) {
		const roomIntel = getRoomIntel(roomName);

		// We can't harvest from highway rooms.
		if (isHighway(roomName)) return 0;

		// Can't remote harvest from our own rooms.
		if (Game.rooms[roomName]?.isMine()) return 0;

		let sourceFactor = 0.25;

		if (!roomIntel.isClaimable()) {
			// Penalty for SK rooms since we can only havest them much later.
			sourceFactor = 0.15;
		}

		// Score modifications related to other players should not be applied to
		// our owned rooms. Else we might abandon rooms because another player
		// claimed nearby. Instead, we should... negotiate.
		if (!forOwnedRoom) {
			// Try not to expand too close to other players.
			if (roomIntel.isOwned() && roomIntel.memory.owner !== 'Invader') return -0.5;

			// If another player has reserved the adjacent room, we can't profit all that well.
			if (roomIntel.isClaimed() && roomIntel.memory.reservation.username !== 'Invader') sourceFactor = 0.1;
		}

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
		const scoutTargets: Record<string, ScoutTarget> = {};
		const openList = this.getScoutOrigins();
		const closedList: Record<string, boolean> = {};

		// Flood fill from own rooms and add rooms we need intel of.
		while (_.size(openList) > 0) {
			const nextRoom = this.getNextRoomCandidate(openList);

			if (!nextRoom) break;

			this.addAdjacentRooms(nextRoom, openList, closedList);
			const info = openList[nextRoom];
			delete openList[nextRoom];
			closedList[nextRoom] = true;

			// Add current room as a candidate for scouting.
			if (
				!scoutTargets[nextRoom]
				|| scoutTargets[nextRoom].range > info.range
				|| !Game.rooms[scoutTargets[nextRoom].origin]
				|| !Game.rooms[scoutTargets[nextRoom].origin].isMine()
			) {
				scoutTargets[nextRoom] = {
					range: info.range,
					origin: info.origin,
					safePath: info.safePath,
				};
			}
		}

		for (const roomName of this.roomStatus.getAllKnownRooms()) {
			if (scoutTargets[roomName]) {
				// Update rooms that are still in scouting range.
				this.roomStatus.setOrigin(roomName, scoutTargets[roomName].origin);
				this.roomStatus.setDistanceToOrigin(roomName, scoutTargets[roomName].range);
			}
			else {
				// Remove rooms that are no longer in scouting range.
				this.roomStatus.deleteRoom(roomName);
			}
		}

		for (const roomName in scoutTargets) {
			if (!this.roomStatus.hasRoom(roomName)) {
				// Add rooms we didn't have in our list, yet.
				this.roomStatus.addRoom(roomName, scoutTargets[roomName].origin, scoutTargets[roomName].range);
			}
		}
	}

	/**
	 * Generates a list of rooms that can serve as a starting point for scouting.
	 *
	 * @return {object}
	 *   A list of rooms info stubs, keyed by room name.
	 */
	getScoutOrigins(): Record<string, ScoutTarget> {
		const openList: Record<string, ScoutTarget> = {};

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
			if (!room.observer) continue;

			this.observers.push(room.observer);
		}

		hivemind.log('strategy').debug('Found Observers:', this.observers);
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
	getNextRoomCandidate(openList: Record<string, ScoutTarget>): string {
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
	addAdjacentRooms(roomName: string, openList: Record<string, ScoutTarget>, closedList: Record<string, boolean>) {
		const info = openList[roomName];
		if (info.range >= (Memory.hivemind.maxScoutDistance || 7)) return;

		const roomIntel = getRoomIntel(roomName);
		for (const exit of _.values<string>(roomIntel.getExits())) {
			if (openList[exit] || closedList[exit]) continue;

			const roomIntel = getRoomIntel(exit);
			const roomIsSafe = !roomIntel.isClaimed() || (roomIntel.memory.reservation && roomIntel.memory.reservation.username === 'Invader');

			openList[exit] = {
				range: info.range + 1,
				origin: info.origin,
				safePath: info.safePath && roomIsSafe,
			};
		}

		for (const portal of roomIntel.getRoomPortals()) {
			if (openList[portal] || closedList[portal]) continue;

			const roomIntel = getRoomIntel(portal);
			const roomIsSafe = !roomIntel.isClaimed() || (roomIntel.memory.reservation && roomIntel.memory.reservation.username === 'Invader');

			openList[portal] = {
				range: info.range + 1,
				origin: info.origin,
				safePath: info.safePath && roomIsSafe,
			};
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
	getClosestObserver(roomName: string): StructureObserver {
		let bestObserver: StructureObserver = null;
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
		for (const room of Game.myRooms) {
			const roomIntel = getRoomIntel(room.name);
			for (const mineralType of roomIntel.getMineralTypes()) {
				this.mineralCount[mineralType] = (this.mineralCount[mineralType] || 0) + 1;
			}
		}
	}
}
