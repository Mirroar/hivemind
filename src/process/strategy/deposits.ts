/* global RoomPosition CREEP_SPAWN_TIME MAX_CREEP_SIZE ATTACK_POWER
CONTROLLER_STRUCTURES STRUCTURE_POWER_SPAWN */

import Process from 'process/process';
import hivemind from 'hivemind';
import NavMesh from 'utils/nav-mesh';
import {getRoomIntel} from 'room-intel';

declare global {
	interface StrategyMemory {
		deposits?: {
			rooms: Record<string, DepositTargetRoom>;
		};
	}

	interface DepositTargetRoom {
		spawnRooms?: {
			room: string;
			distance: number;
		}[];
		isActive?: boolean;
		scouted?: boolean;
	}
}

export default class DepositMiningProcess extends Process {
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

		if (!Memory.strategy.deposits) {
			Memory.strategy.deposits = {rooms: {}};
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
		if (!hivemind.settings.get('enableDepositMining')) return false;

		return true;
	}

	/**
	 * Analizes the power banks detected by intel, to decide which and how to attack.
	 */
	run() {
		// @todo Add throttle like with remote harvesting.
		const memory = Memory.strategy.deposits;
		this.mesh = new NavMesh();

		_.each(memory.rooms, (info, roomName) => {
			const roomIntel = getRoomIntel(roomName);
			const deposits = roomIntel.getDepositInfo();

			if (info.isActive) {
				// Stop operation if no active deposit detected.
				if (!deposits || deposits.length === 0) {
					delete memory[roomName];
				}

				// Otherwise, continue normally. No need to update spawn rooms.
				return;
			}

			// Disregard rooms the user doesn't want harvested.
			const roomFilter = hivemind.settings.get<(roomName: string) => boolean>('depositMineRoomFilter');
			if (roomFilter && !roomFilter(roomName)) return;

			// Disregard rooms other players are already harvesting.
			if (Memory.rooms[roomName] && Memory.rooms[roomName].enemies && (Memory.rooms[roomName].enemies.parts[WORK] || 0) > 0) return;

			// Determine which rooms need to spawn creeps.
			const spawnRooms = this.getPotentialSpawns(roomName);
			if (spawnRooms && spawnRooms.length > 0) {
				info.isActive = true;
				info.spawnRooms = spawnRooms;
			}
		});
	}

	getPotentialSpawns(targetRoom: string): Array<{room: string; distance: number}> {
		let potentialSpawns: Array<{room: string; distance: number}> = [];
		for (const room of Game.myRooms) {
			// @todo Allow spawning in rooms full of minerals, as long as there's
			// another room to deliver to in range.
			if (room.isFullOnMinerals()) continue;
			if (room.getEffectiveAvailableEnergy() < hivemind.settings.get('minEnergyForDepositMining')) continue;
			if (room.controller.level < hivemind.settings.get('minRclForDepositMining')) continue;
			if (Game.map.getRoomLinearDistance(targetRoom, room.name) > hivemind.settings.get('maxRangeForDepositMining')) continue;

			// @todo Use actual position of power cache.
			const roomRoute = this.mesh.findPath(new RoomPosition(25, 25, room.name), new RoomPosition(25, 25, targetRoom));
			if (roomRoute.incomplete || roomRoute.path.length > 3 * hivemind.settings.get<number>('maxRangeForDepositMining')) continue;

			hivemind.log('strategy').debug('Could spawn creeps in', room.name, 'with distance', roomRoute.path.length);

			potentialSpawns.push({
				room: room.name,
				distance: roomRoute.path.length,
			});
		}

		potentialSpawns = _.sortBy(potentialSpawns, 'distance');

		return potentialSpawns;
	}
}
