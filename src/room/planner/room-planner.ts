/* global PathFinder Room RoomPosition RoomVisual CONTROLLER_STRUCTURES
FIND_SOURCES */

import cache from 'utils/cache';
import hivemind from 'hivemind';
import RoomPlan from 'room/planner/room-plan';
import RoomPlanGenerator from 'room/planner/room-plan-generator';
import stats from 'utils/stats';
import utilities from 'utilities';
import {getRoomPlanFor, setRoomPlanFor} from 'room/planner/room-plan-management';
import {getRoomIntel} from 'room-intel';

declare global {
	interface Room {
		roomPlanner: RoomPlanner;
	}

	interface RoomMemory {
		roomPlanner?: any;
	}

	interface RoomPosition {
		isIrrelevant?: boolean;
		isRelevant?: boolean;
	}
}

// The room plan process is recreated every tick, but room plan generators
// are persistent in heap.
const generatorCache: Record<string, RoomPlanGenerator> = {};

function getGenerator(roomName: string): RoomPlanGenerator {
	return generatorCache[roomName];
}

function setGenerator(roomName, generator: RoomPlanGenerator) {
	generatorCache[roomName] = generator;
}

export interface RoomPlannerMemory {
	drawDebug: number;
	lastRun: number;
	adjacentSafe: Record<string, boolean>;
	adjacentSafeRooms: string[];
}

export default class RoomPlanner {
	protected activeRoomPlan: RoomPlan;
	protected activeRoomPlanVersion: number;
	protected generator: RoomPlanGenerator;
	protected roomPlannerVersion: number;
	readonly roomName: string;
	protected memory: RoomPlannerMemory;

	/**
	 * Creates a room layout and makes sure the room is built accordingly.
	 * @constructor
	 *
	 * @param {string} roomName
	 *   Name of the room this room planner is assigned to.
	 */
	constructor(roomName: string) {
		this.roomPlannerVersion = 41;
		this.roomName = roomName;
		const activeInfo = getRoomPlanFor(roomName);
		this.activeRoomPlan = activeInfo && activeInfo.plan;
		this.activeRoomPlanVersion = activeInfo ? activeInfo.version : 0;

		const key = 'planner:' + roomName;
		if (!hivemind.segmentMemory.has(key)) {
			hivemind.segmentMemory.set(key, {});
		}

		this.memory = hivemind.segmentMemory.get(key);

		this.generator = getGenerator(roomName);
		if (this.generator) {
			this.generator.visualize();
		}

		if (this.activeRoomPlan && (hivemind.settings.get('visualizeRoomPlan') || (this.memory.drawDebug || 0) > 0)) {
			this.memory.drawDebug--;
			this.activeRoomPlan.visualize();
		}
	}

	reloadRoomPlan() {
		const activeInfo = getRoomPlanFor(this.roomName);
		this.activeRoomPlan = activeInfo && activeInfo.plan;
		this.activeRoomPlanVersion = activeInfo ? activeInfo.version : 0;
	}

	/**
	 * Allows this room planner to give commands in controlled rooms.
	 */
	runLogic() {
		if (Game.cpu.bucket < 3500) return;
		if (!hivemind.segmentMemory.isReady()) return;

		this.manageRoomPlanGeneration();

		if (this.memory.lastRun && !hivemind.hasIntervalPassed(100, this.memory.lastRun)) return;
		this.memory.lastRun = Game.time;

		// @todo Move this check into initializeRoomPlanGenerationIfNecessary, but
		// cache result for 100 ticks. Then we can eliminate `lastRun`.
		this.checkAdjacentRooms();
	}

	manageRoomPlanGeneration() {
		// Recalculate room layout if using a new version.
		this.initializeRoomPlanGenerationIfNecessary();
		if (!this.generator) return;

		this.continueRoomPlanGeneration();
		if (!this.isPlanningFinished()) return;

		this.applyGeneratedRoomPlan();
	}

	initializeRoomPlanGenerationIfNecessary() {
		if (this.activeRoomPlan && this.activeRoomPlanVersion === this.roomPlannerVersion) return;
		if (this.generator) return;

		this.startRoomPlanGeneration();
	}

	startRoomPlanGeneration() {
		this.generator = new RoomPlanGenerator(this.roomName, this.roomPlannerVersion);
		setGenerator(this.roomName, this.generator);
	}

	continueRoomPlanGeneration() {
		const cpuStart = Game.cpu.getUsed();
		if (cpuStart >= Game.cpu.tickLimit / 2) return;

		const cpuUsage = stats.getStat('cpu_total', 1000) || stats.getStat('cpu_total', 10) || 0;
		const cpuLimit = Math.min(Game.cpu.tickLimit / 2, 0.8 * Math.max(Game.cpu.limit - cpuUsage, Game.cpu.limit / 10));

		while (!this.isPlanningFinished() && Game.cpu.getUsed() - cpuStart < cpuLimit) {
			this.generator.generate();
		}
	}

	applyGeneratedRoomPlan() {
		this.generator.outputScores();
		this.activeRoomPlan = this.generator.getRoomPlan();
		setRoomPlanFor(this.roomName, this.activeRoomPlan, this.roomPlannerVersion);
		hivemind.log('rooms', this.roomName).info('Stored room plan for room ' + this.roomName);
		delete this.generator;
		setGenerator(this.roomName, null);

		// Reset harvest position info for harvesters in case they are not correctly
		// assigned any more.
		if (Game.rooms[this.roomName]) {
			_.each(Game.rooms[this.roomName].creepsByRole.harvester, (creep: HarvesterCreep) => {
				delete creep.memory.harvestPos;
				delete creep.memory.noHarvestPos;
			});
		}

		// Show result of planning for a few ticks.
		// @todo Make configurable.
		this.memory.drawDebug = 20;
	}

	/**
	 * Checks which adjacent rooms are owned by ourselves or otherwise safe.
	 */
	checkAdjacentRooms() {
		if (!this.memory.adjacentSafe) {
			this.memory.adjacentSafe = {
				N: false,
				E: false,
				S: false,
				W: false,
			};
		}

		const newStatus = getRoomIntel(this.roomName).calculateAdjacentRoomSafety();
		this.memory.adjacentSafeRooms = newStatus.safeRooms;

		// Check if status changed since last check.
		for (const dir in newStatus.directions) {
			if (newStatus.directions[dir] !== this.memory.adjacentSafe[dir]) {
				// Status has changed, recalculate building positioning.
				hivemind.log('room plan', this.roomName).debug('changed adjacent room status!');
				Game.notify(
					'🛡 Exit safety has changed for room ' + this.roomName + '!\n\n'
					+ 'N: ' + (this.memory.adjacentSafe.N ? 'safe' : 'not safe') + ' -> ' + (newStatus.directions.N ? 'safe' : 'not safe') + '\n'
					+ 'E: ' + (this.memory.adjacentSafe.E ? 'safe' : 'not safe') + ' -> ' + (newStatus.directions.E ? 'safe' : 'not safe') + '\n'
					+ 'S: ' + (this.memory.adjacentSafe.S ? 'safe' : 'not safe') + ' -> ' + (newStatus.directions.S ? 'safe' : 'not safe') + '\n'
					+ 'W: ' + (this.memory.adjacentSafe.W ? 'safe' : 'not safe') + ' -> ' + (newStatus.directions.W ? 'safe' : 'not safe') + '\n',
				);

				this.startRoomPlanGeneration();

				this.memory.adjacentSafe = newStatus.directions;
				break;
			}
		}
	}

	/**
	 * Gets list of safe neighboring rooms.
	 *
	 * @return {string[]}
	 *   An array of room names.
	 */
	getAdjacentSafeRooms(): string[] {
		return this.memory.adjacentSafeRooms || [];
	}

	/**
	 * Gets the room's center position.
	 *
	 * @return {RoomPosition}
	 *   The center position determined by planning.
	 */
	getRoomCenter(): RoomPosition {
		for (const pos of this.getLocations('center')) {
			return pos;
		}

		// Fallback value if for some reason there is no assigned center position.
		return new RoomPosition(25, 25, this.roomName);
	}

	/**
	 * Returns all positions planned for a certain type.
	 *
	 * @param {string} locationType
	 *   Type of location to get positions for.
	 *
	 * @return {RoomPosition[]}
	 *   An Array of positions where the given location type is planned.
	 */
	getLocations(locationType: string): RoomPosition[] {
		if (this.activeRoomPlan) {
			return this.activeRoomPlan.getPositions(locationType);
		}

		return [];
	}

	/**
	 * Checks whether a certain position is planned for building something.
	 *
	 * @param {RoomPosition} pos
	 *   Room position to check against.
	 * @param {string} locationType
	 *   Type of location to check for.
	 *
	 * @return {boolean}
	 *   True if the given location type is planned for the given position.
	 */
	isPlannedLocation(pos: RoomPosition, locationType: string): boolean {
		if (!this.activeRoomPlan) return false;

		return this.activeRoomPlan.hasPosition(locationType, pos);
	}

	/**
	 * Checks whether planning for this room is finished.
	 *
	 * @return {boolean}
	 *   Whether all structures have been planned for this room.
	 */
	isPlanningFinished(): boolean {
		if (!this.generator) return true;
		if (this.generator.isFinished()) return true;

		return false;
	}

	/**
	 * Gets a cost matrix representing this room when it's fully built.
	 *
	 * @return {PathFinder.CostMatrix}
	 *   The requested cost matrix.
	 */
	getNavigationMatrix(): CostMatrix {
		if (!this.activeRoomPlan) return new PathFinder.CostMatrix();

		return cache.inHeap('plannerCostMatrix:' + this.roomName, 500, () => this.activeRoomPlan.createNavigationMatrix());
	}
}
