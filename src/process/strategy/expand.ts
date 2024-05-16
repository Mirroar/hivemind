/* global PathFinder Room RoomPosition CREEP_LIFE_TIME FIND_MY_CREEPS
TERRAIN_MASK_WALL STRUCTURE_ROAD FIND_CONSTRUCTION_SITES STRUCTURE_RAMPART */

import cache from 'utils/cache';
import Process from 'process/process';
import hivemind from 'hivemind';
import interShard from 'intershard';
import NavMesh from 'utils/nav-mesh';
import settings from 'settings-manager';
import Squad from 'manager.squad';
import stats from 'utils/stats';
import {getUsername} from 'utils/account';
import {getRoomIntel} from 'room-intel';

interface ExpansionTarget extends RoomListEntry {
	roomName: string;
	spawnRoom: string;
}

type ExpandProcessMemory = {
	started?: number;
	claimed?: number;
	currentTarget: {
		roomName: string;
		supportingRooms: string[];
		spawnRoom: string;
	};
	pathBlocked: number;
	evacuatingRoom: {
		name: string;
		cooldown: number;
	};
	failedExpansions: Array<{
		roomName: string;
		time: number;
	}>;
};

declare global {
	interface StrategyMemory {
		expand?: ExpandProcessMemory;
	}

	namespace NodeJS {
		interface Global {
			ExpandProcess: typeof ExpandProcess;
		}
	}
}

let lastCleanup = 0;

let expansionTargetScoringProgress: {
	rooms: Record<string, boolean>;
	bestTarget: ExpansionTarget;
};

export default class ExpandProcess extends Process {
	memory: ExpandProcessMemory;
	navMesh: NavMesh;

	/**
	 * Chooses rooms for expansion and sends creeps there.
	 * @constructor
	 *
	 * @param {object} parameters
	 *   Options on how to run this process.
	 */
	constructor(parameters: ProcessParameters) {
		super(parameters);

		if (!Memory.strategy) {
			Memory.strategy = {};
		}

		if (!Memory.strategy.expand) {
			Memory.strategy.expand = {} as ExpandProcessMemory;
		}

		this.memory = Memory.strategy.expand;
		this.navMesh = new NavMesh();
	}

	/**
	 * Sends a squad for expanding to a new room if GCL and CPU allow.
	 */
	run() {
		// We probably can't expect to expand earlier than 100 ticks into the game.
		if (!stats.getStat('cpu_total', 1000)) return;

		Memory.hivemind.canExpand = false;
		if (!this.memory.currentTarget && this.mayExpand()) {
			Memory.hivemind.canExpand = true;
			this.chooseNewExpansionTarget();
		}

		this.manageCurrentExpansion();
		this.abandonWeakRooms();
		this.abandonStripmines();

		this.manageEvacuation();
		this.cleanupMemory();
	}

	getCpuStats() {
		const harvestRooms = Memory.strategy.remoteHarvesting ? Memory.strategy.remoteHarvesting.currentCount : 0;

		// If we have many rooms with remote harvesting, be a bit more lenient
		// on CPU cap for claiming a new room. Remote harvesting can always be
		// dialed back to the most efficient rooms to save CPU.
		const cpuLimit = harvestRooms < 5 ? 0.8 : 1;
		const shortTermCpuUsage = stats.getStat('cpu_total', 1000) / Game.cpu.limit;
		const longTermCpuUsage = stats.getStat('cpu_total', 10_000) ? stats.getStat('cpu_total', 10_000) / Game.cpu.limit : shortTermCpuUsage;

		return {cpuLimit, shortTermCpuUsage, longTermCpuUsage};
	}

	mayExpand(): boolean {
		const ownedRooms = Game.myRooms.length;
		const hasFreeControlLevels = ownedRooms < Game.gcl.level;
		const maxRooms = settings.get('maxOwnedRooms');
		const shardMemory = interShard.getLocalMemory();
		const mayHaveMoreRooms = !maxRooms || (shardMemory.info && shardMemory.info.ownedRooms < maxRooms);

		const cpuStats = this.getCpuStats();

		return hasFreeControlLevels
			&& mayHaveMoreRooms
			&& cpuStats.shortTermCpuUsage < cpuStats.cpuLimit
			&& cpuStats.longTermCpuUsage < cpuStats.cpuLimit;
	}

	/**
	 * Chooses a new target room to expand to.
	 */
	chooseNewExpansionTarget() {
		if (!hivemind.segmentMemory.isReady()) return;

		// Choose a room to expand to.
		let bestTarget;
		let modifiedBestExpansionScore: number;
		const startTime = Game.cpu.getUsed();
		if (expansionTargetScoringProgress) {
			bestTarget = expansionTargetScoringProgress.bestTarget;
			if (bestTarget) modifiedBestExpansionScore = this.getModifiedExpansionScore(bestTarget.roomName, bestTarget);
		}
		else {
			expansionTargetScoringProgress = {
				rooms: {},
				bestTarget: null,
			};
		}

		for (const roomName in Memory.strategy.roomList) {
			const roomFilter = settings.get('expansionRoomFilter');
			if (roomFilter && !roomFilter(roomName)) {
				expansionTargetScoringProgress.rooms[roomName] = true;
				continue;
			}

			const info = Memory.strategy.roomList[roomName];
			if (Game.cpu.getUsed() - startTime >= settings.get('maxExpansionCpuPerTick')) {
				// Don't spend more than configured cpu amount trying to find
				// a target each tick.
				hivemind.log('strategy').debug('Suspended trying to find expansion target.', _.size(expansionTargetScoringProgress.rooms), '/', _.size(Memory.strategy.roomList), 'rooms checked so far.');
				hivemind.log('strategy').debug('Current best target:', bestTarget ? bestTarget.roomName : 'N/A', '@', bestTarget ? modifiedBestExpansionScore : 'N/A');
				return;
			}

			if (expansionTargetScoringProgress.rooms[roomName]) continue;

			const roomIntel = getRoomIntel(roomName);
			if (roomIntel.isOwned()) continue;

			expansionTargetScoringProgress.rooms[roomName] = true;
			if (typeof info.expansionScore === 'undefined' || info.expansionScore === 0) continue;

			const modifiedExpansionScore = this.getModifiedExpansionScore(roomName, info);
			if (bestTarget && modifiedBestExpansionScore >= modifiedExpansionScore) continue;
			if (Game.rooms[roomName] && Game.rooms[roomName].isMine()) continue;

			// Don't try to expand to a room that can't be reached safely.
			const bestSpawn = this.findClosestSpawn(roomName);
			if (!bestSpawn) continue;

			bestTarget = {...info, spawnRoom: bestSpawn, roomName};
			modifiedBestExpansionScore = modifiedExpansionScore;
			expansionTargetScoringProgress.bestTarget = bestTarget;
		}

		if (bestTarget) {
			expansionTargetScoringProgress = null;
			this.startExpansion(bestTarget);
		}
	}

	/**
	 * Gets the modified expansion score for a room.
	 *
	 * This takes into account failed expansion attempts in close proximity to
	 * the target room.
	 */
	getModifiedExpansionScore(roomName: string, info: RoomListEntry): number {
		let score = info.expansionScore || 0;

		for (const failedAttempt of this.memory.failedExpansions || []) {
			const distance = Game.map.getRoomLinearDistance(roomName, failedAttempt.roomName);
			let multiplier = 1;
			const elapsedTicks = Game.time - failedAttempt.time;
			if (elapsedTicks > 1_000_000) continue;
			if (elapsedTicks > 100_000) multiplier = 1 - ((elapsedTicks - 100_000) / 900_000);

			if (distance === 0) score -= multiplier;
			else if (distance < 6) score -= multiplier / (distance + 1);
		}

		return score;
	}

	/**
	 * Starts expanding to a given room.
	 *
	 * @param {object} roomInfo
	 *   Scout information of the room to expand to.
	 */
	startExpansion(roomInfo) {
		this.memory.currentTarget = roomInfo;

		this.manageStripmines(roomInfo.roomName);

		// Spawn expansion squad at origin.
		const squad = new Squad('expand');
		squad.setSpawn(roomInfo.spawnRoom);

		// Send to target room.
		squad.setTarget(new RoomPosition(25, 25, roomInfo.roomName));
		squad.clearUnits();
		squad.setUnitCount('brawler', 1);
		squad.setUnitCount('singleClaim', 1);
		squad.setUnitCount('builder', 2);
		this.memory.started = Game.time;

		hivemind.log('strategy').notify('🏴 Started expanding to ' + roomInfo.roomName);
	}

	manageStripmines(roomName: string) {
		const maxMines = 0; // Math.floor((Game.myRooms.length + 1) / 3);
		const totalMines = _.filter(Game.myRooms, room => room.isStripmine()).length;

		if (totalMines < maxMines) {
			Memory.rooms[roomName].isStripmine = true;
		}
	}

	/**
	 * Manages getting an expansion up and running.
	 */
	manageCurrentExpansion() {
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
					squad.setUnitCount('claimer', 0);
				}

				if (room.controller.level > 3 && room.storage) {
					// Room has RCL 4 and a storage, it can fend for itself now. Success!
					this.stopExpansion();
					return;
				}
			}
			else {
				if (room.controller.reservation && room.controller.reservation.username !== getUsername() && room.controller.reservation.ticksToEnd > 100) {
					squad.setUnitCount('singleClaim', 0);
					squad.setUnitCount('claimer', Math.ceil(room.controller.reservation.ticksToEnd / 2000));
				}
				else {
					squad.setUnitCount('singleClaim', 1);
					squad.setUnitCount('claimer', 0);
				}

				this.checkClaimPath();
			}
		}

		if (this.hasExpansionFailed()) {
			this.recordFailedExpansion();
			this.stopExpansion();
		}
	}

	/**
	 * Determines if the current expansion effort has failed.
	 */
	hasExpansionFailed(): boolean {
		// Abort if claiming takes too long.
		// @todo And we don't have anything to dismantle in the way of the controller.
		if (!this.memory.claimed && Game.time - this.memory.started > 5 * CREEP_LIFE_TIME) return true;

		// If a lot of time has passed after claiming, let the room fend for itself
		// anyways, either it will be lost or fix itself.
		if (this.memory.claimed && Game.time - this.memory.claimed > 20 * CREEP_LIFE_TIME) return true;

		// If we lose control of the room, there's been a problem.
		const room = Game.rooms[this.memory.currentTarget.roomName];
		if (this.memory.claimed && (!room || !room.controller.my)) return true;

		// @todo Think about any more cases we need to cover.
		return false;
	}

	/**
	 * Keeps track of failes expansions so the next expansion goes somewhere else.
	 */
	recordFailedExpansion() {
		const roomName = this.memory.currentTarget.roomName;
		if (!this.memory.failedExpansions) this.memory.failedExpansions = [];

		this.memory.failedExpansions.push({
			roomName,
			time: Game.time,
		});

		hivemind.log('strategy').notify('💀 Expanding to ' + roomName + ' has failed. A new target will be chosen soon.');
	}

	/**
	 * Stops current expansion plans by disbanding all related squads.
	 */
	stopExpansion() {
		const roomName = this.memory.currentTarget.roomName;
		const squad = new Squad('expand');
		squad.disband();

		_.each(Game.squads, (squad, squadName) => {
			if (squadName.startsWith('expandSupport.' + roomName)) {
				squad.disband();
			}
		});

		delete this.memory.currentTarget;
		delete this.memory.started;
		delete this.memory.claimed;
		delete this.memory.pathBlocked;
	}

	/**
	 * Sends extra builders from rooms in range so the room is self-sufficient sooner.
	 */
	manageExpansionSupport() {
		const info = this.memory.currentTarget;
		if (!info) return;

		const activeSquads = {};
		info.supportingRooms = [];

		// @todo Start with closest rooms first.
		for (const room of Game.myRooms) {
			// 5 Support squads max.
			if (_.size(activeSquads) >= 5) break;

			if (room.controller.level < 4) continue;
			if ((room.structuresByType[STRUCTURE_SPAWN] || []).length === 0) continue;
			if (room.name === info.spawnRoom || room.name === info.roomName) continue;
			if (room.getEffectiveAvailableEnergy() < 50_000) continue;

			const path = cache.inHeap('spawnAssistPath:' + info.roomName + ':' + room.name, 2000, () => this.navMesh.findPath(new RoomPosition(25, 25, room.name), new RoomPosition(25, 25, info.roomName), {maxPathLength: 700}));
			if (!path || path.incomplete) continue;

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

			info.supportingRooms.push(room.name);
			activeSquads[squadName] = true;
		}

		// Remove support squads from older rooms.
		// @todo This should no longer be necessary when the code in stopExpansion
		// works reliably.
		_.each(Game.squads, (squad, squadName) => {
			if (squadName.startsWith('expandSupport.') && !activeSquads[squadName]) {
				squad.disband();
			}
		});
	}

	/**
	 * Checks if creeps can reach the room's controller, builds tunnels otherwise.
	 */
	checkClaimPath() {
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

		const roads = room.structuresByType[STRUCTURE_ROAD] || [];
		for (const road of roads) {
			matrix.set(road.pos.x, road.pos.y, 1);
		}

		// Treat road sites as walkable so we don't calculate multiple tunnel paths.
		const roadSites = room.find(FIND_CONSTRUCTION_SITES, {
			filter: s => s.structureType === STRUCTURE_ROAD,
		});
		for (const site of roadSites) {
			matrix.set(site.pos.x, site.pos.y, 1);
		}

		const blockingStructures = _.filter(room.structures, s => !s.isWalkable());
		for (const structure of blockingStructures) {
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
					if (terrain.get(x, y) === TERRAIN_MASK_WALL && matrix.get(x, y) > 50) {
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
	}

	/**
	 * Checks if there is a safe path to the current expansion for spawned creeps.
	 */
	checkAccessPath() {
		const info = this.memory.currentTarget;
		if (!info) return;

		const originRoom = Game.rooms[info.spawnRoom];
		if (originRoom) {
			const path = this.navMesh.findPath(new RoomPosition(25, 25, originRoom.name), new RoomPosition(25, 25, info.roomName), {maxPathLength: 500});
			if (!path || path.incomplete) {
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
	}

	/**
	 * Finds the closest valid spawn location for an expansion.
	 *
	 * @param {string} targetRoom
	 *   Name of the room we're expanding to.
	 *
	 * @return {string}
	 *   Name of the room to spawn from.
	 */
	findClosestSpawn(targetRoom: string): string {
		let bestRoom = null;
		let bestLength = 0;
		for (const room of Game.myRooms) {
			if (room.controller.level < 5) continue;
			if (room.name === targetRoom) continue;
			if ((room.structuresByType[STRUCTURE_SPAWN] || []).length === 0) continue;

			const path = cache.inHeap('spawnPath:' + targetRoom + ':' + room.name, 1000, () => this.navMesh.findPath(new RoomPosition(25, 25, room.name), new RoomPosition(25, 25, targetRoom), {maxPathLength: 500}));
			if (!path || path.incomplete) continue;

			if (!bestRoom || bestLength > path.path.length) {
				bestRoom = room;
				bestLength = path.path.length;
			}
		}

		return bestRoom && bestRoom.name;
	}

	/**
	 * Decides if it's worth giving up a weak room in favor of a new expansion.
	 */
	abandonWeakRooms() {
		// Only abandon rooms if we aren't in the process of expanding.
		if (this.memory.currentTarget) return;

		// Only choose a new target if we aren't already relocating.
		if (this.memory.evacuatingRoom) return;

		// Only give up a room if we need more CPU.
		const cpuStats = this.getCpuStats();
		if (cpuStats.shortTermCpuUsage < cpuStats.cpuLimit) return;
		if (cpuStats.longTermCpuUsage < cpuStats.cpuLimit) return;

		// @todo Take into account better expansions on other shards.
		// We expect a minimal gain from giving up a room.
		const shardMemory = interShard.getLocalMemory();
		if (!shardMemory.info) return;
		if (shardMemory.info.ownedRooms && shardMemory.info.ownedRooms < 2) return;
		if (!shardMemory.info.rooms) return;
		if (!shardMemory.info.rooms.bestExpansion) return;
		if (!shardMemory.info.rooms.worstRoom) return;

		const hasBetterExpansion = shardMemory.info.rooms.bestExpansion.score - shardMemory.info.rooms.worstRoom.score >= 0.5;
		const maxRooms = settings.get('maxOwnedRooms');
		const hasTooManyRooms = maxRooms && shardMemory.info.ownedRooms > maxRooms;
		if (!hasBetterExpansion && !hasTooManyRooms) return;

		const roomName = shardMemory.info.rooms.worstRoom.name;
		if (!Game.rooms[roomName] || !Game.rooms[roomName].isMine()) return;

		Game.rooms[roomName].setEvacuating(true);
		this.memory.evacuatingRoom = {
			name: roomName,
			cooldown: null,
		};
		hivemind.log('strategy').notify('💀 Evacuating ' + roomName + ' to free up CPU cycles for expanding. Possible Target: ' + shardMemory.info.rooms.bestExpansion.name);
	}

	/**
	 * Decides if it's worth giving up a weak room in favor of a new expansion.
	 */
	abandonStripmines() {
		// Only choose a new target if we aren't already relocating.
		if (this.memory.evacuatingRoom) return;

		for (const room of Game.myRooms) {
			if (!room.isStripmine()) continue;
			if (!room.terminal) continue;
			if (_.some(room.minerals, mineral => mineral.mineralAmount > 0)) continue;

			room.setEvacuating(true);
			this.memory.evacuatingRoom = {
				name: room.name,
				cooldown: null,
			};
			hivemind.log('strategy').notify('💀 Evacuating ' + room.name + ' to mine another room instead.');
			return;
		}
	}

	/**
	 * Manages the room we are currently abandoning.
	 */
	manageEvacuation() {
		if (!this.memory.evacuatingRoom) return;

		const roomName = this.memory.evacuatingRoom.name;
		const room = Game.rooms[roomName];
		if (!room || !room.isMine()) {
			// We don't own this room anymore for some reason. Guess we're done.
			if (!this.memory.evacuatingRoom.cooldown) {
				// Start a cooldown timer of about 5000 ticks before considering
				// abandoning more (enough for creeps to despawn and CPU to normalize).
				this.memory.evacuatingRoom.cooldown = Game.time + 5000;
				delete this.memory.evacuatingRoom.name;
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
		if (room.nuker && room.terminal && room.terminal.store.getFreeCapacity() > room.nuker.store.getUsedCapacity(RESOURCE_ENERGY)) {
			room.nuker.destroy();
			return;
		}

		// Terminal needs to be mostly empty and contain mostly energy.
		if (room.terminal && room.terminal.store.getUsedCapacity() > 10_000) return;
		if (room.terminal && room.terminal.store.getUsedCapacity() > 0 && room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) / room.terminal.store.getUsedCapacity() < 0.8) return;

		const filledRuins = room.find(FIND_RUINS, {filter: ruin => ruin.store.getUsedCapacity() > 100});
		if (filledRuins?.length > 0) return;

		const droppedResources = room.find(FIND_DROPPED_RESOURCES, {filter: resource => resource.amount > 100});
		if (droppedResources?.length > 0) return;

		// Alright, this is it, flipping the switch!
		if (room.controller.unclaim() === OK) {
			room.setEvacuating(false);
			_.each(
				_.filter(room.find(FIND_MY_CREEPS), creep => creep.memory.singleRoom === room.name),
				creep => creep.suicide(),
			);
		}
	}

	private cleanupMemory() {
		if (!hivemind.hasIntervalPassed(5000, lastCleanup)) return;
		lastCleanup = Game.time;

		if (!this.memory.failedExpansions) return;

		for (let i = this.memory.failedExpansions.length - 1; i >= 0; i--) {
			if (Game.time - this.memory.failedExpansions[i].time < 1_000_000) continue;

			this.memory.failedExpansions.splice(i, 1);
		}
	}
}
global.ExpandProcess = ExpandProcess;
