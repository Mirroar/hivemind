/* global RoomPosition CREEP_SPAWN_TIME MAX_CREEP_SIZE ATTACK_POWER
CONTROLLER_STRUCTURES STRUCTURE_POWER_SPAWN */

import Process from 'process/process';
import hivemind from 'hivemind';
import NavMesh from 'utils/nav-mesh';

declare global {
	interface StrategyMemory {
		power?: {
			rooms: Record<string, PowerTargetRoom>;
		};
	}

	interface PowerTargetRoom {
		decays: number;
		isActive?: boolean;
		amount: number;
		hits: number;
		freeTiles: number;
		maxAttackers?: number;
		neededDps?: number;
		dps?: number;
		spawnRooms?: Record<string, {room: string, distance: number}>;
	}
}

export default class PowerMiningProcess extends Process {
	mesh: NavMesh;

	/**
	 * Decides on power sources to attack and loot.
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

		if (!Memory.strategy.power) {
			Memory.strategy.power = {rooms: {}};
		}
	}

	/**
	 * Decides whether this process is allowed to run.
	 *
	 * @return {boolean}
	 *   True if power harvesting is enabled.
	 */
	shouldRun(): boolean {
		if (!super.shouldRun()) return false;
		if (!hivemind.settings.get('enablePowerMining')) return false;

		return true;
	}

	/**
	 * Analizes the power banks detected by intel, to decide which and how to attack.
	 */
	run() {
		// @todo Add throttle like with remote harvesting.
		const memory = Memory.strategy.power;
		this.mesh = new NavMesh();

		_.each(memory.rooms, (info, roomName) => {
			// @todo Skip room if we already decided to harvest it.
			// Calculate DPS we'd need to do to harvest this power.
			let timeRemaining = info.decays - Game.time;

			if (info.isActive) {
				// No need to modify this information.
				if (timeRemaining <= 0) {
					delete memory.rooms[roomName];
				}

				return;
			}

			// Substract time we need to spawn first set of attackers.
			timeRemaining -= CREEP_SPAWN_TIME * MAX_CREEP_SIZE;

			// Substract extra time until spawns are ready to generate our creeps.
			timeRemaining -= CREEP_SPAWN_TIME * MAX_CREEP_SIZE * 2 / 3;

			if (timeRemaining <= 0) {
				delete memory.rooms[roomName];
				return;
			}

			// Disregard rooms the user doesn't want harvested.
			const roomFilter = hivemind.settings.get('powerMineRoomFilter');
			if (roomFilter && !roomFilter(roomName)) return;

			// Skip if this doesn't need harvesting anymore.
			if (info.amount <= 0 || info.hits <= 0) return;

			// Skip if low amount.
			if (info.amount < hivemind.settings.get('powerBankMinAmount')) return;

			const dps = info.hits / timeRemaining;
			const partsPerDPS = 2 / ATTACK_POWER;
			const numCreeps = Math.ceil(dps * partsPerDPS / MAX_CREEP_SIZE);

			if (numCreeps > Math.min(5, info.freeTiles)) {
				// We can't attack with enough creeps.
				delete memory.rooms[roomName];
				return;
			}

			const potentialSpawns = this.getPotentialSpawnRoomsForHarvesting(roomName);

			// Substract travel time until all attackers could be there.
			let maxAttackers = 0;
			let travelTime = 0;
			let failed = true;
			const neededRooms: Record<string, {room: string; distance: number}> = {};
			let finalDps = 0;
			for (const spawnInfo of potentialSpawns) {
				maxAttackers += 2;
				// Estimate travel time at 50 ticks per room.
				travelTime = spawnInfo.distance * 50;

				const neededDps = info.hits / (timeRemaining - travelTime);
				// @todo Needed Dps multiplier is this high because currently creeps can only attack every 2 ticks.
				const numCreeps = Math.ceil(neededDps * 1.2 * partsPerDPS / MAX_CREEP_SIZE);

				if (numCreeps > Math.min(6, info.freeTiles)) {
					// Would need too many creeps at this distance.
					break;
				}

				neededRooms[spawnInfo.room] = spawnInfo;

				if (maxAttackers >= numCreeps) {
					// Alright, we can spawn enough creeps!
					finalDps = neededDps;
					failed = false;
					break;
				}
			}

			if (failed) {
				return;
			}

			info.spawnRooms = neededRooms;
			info.maxAttackers = maxAttackers;
			info.isActive = true;
			info.neededDps = finalDps;
			info.dps = maxAttackers * MAX_CREEP_SIZE / partsPerDPS;

			// @todo Record neededRooms and maxAttackers.
			// @todo Calculate number of transporters needed in the end.

			// @todo Start spawning.
			this.logHarvestIntent(roomName, info);
		});
	}

	getPotentialSpawnRoomsForHarvesting(roomName: string): Array<{room: string; distance: number}> {
		// Determine which rooms need to spawn creeps.
		let potentialSpawns: Array<{room: string; distance: number}> = [];
		for (const room of Game.myRooms) {
			if (room.isFullOnPower()) continue;
			if (room.getEffectiveAvailableEnergy() < hivemind.settings.get('minEnergyForPowerHarvesting')) continue;
			if (room.controller.level < hivemind.settings.get('minRclForPowerMining')) continue;
			if (Game.map.getRoomLinearDistance(roomName, room.name) > hivemind.settings.get('maxRangeForPowerMining')) continue;

			// @todo Use actual position of power cache.
			const roomRoute = this.mesh.findPath(new RoomPosition(25, 25, room.name), new RoomPosition(25, 25, roomName));
			if (roomRoute.incomplete || roomRoute.path.length > 2 * hivemind.settings.get('maxRangeForPowerMining')) continue;

			hivemind.log('strategy').debug('Could spawn creeps in', room.name, 'with distance', roomRoute.path.length);

			potentialSpawns.push({
				room: room.name,
				distance: roomRoute.path.length,
			});
		}

		potentialSpawns = _.sortBy(potentialSpawns, 'distance');

		return potentialSpawns;
	}

	/**
	 * Informs the user of a starting power mining process.
	 * @param {String} roomName
	 *   Name of the room where power is being harvested.
	 * @param {object} info
	 *   Scout information and calculated values for this harvesting effort.
	 */
	logHarvestIntent(roomName, info) {
		hivemind.log('strategy').info('Gathering ' + (info.amount || 'N/A') + ' power from room ' + roomName + '.');

		if (!Memory.strategy || !Memory.strategy.reports) return;
		if (!Memory.strategy.reports.data.power) Memory.strategy.reports.data.power = [];
		const memory = Memory.strategy.reports.data.power;

		memory.push({
			roomName,
			info,
		});
	}
}
