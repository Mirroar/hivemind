/* global PathFinder Room RoomPosition RoomVisual OBSTACLE_OBJECT_TYPES
CONTROLLER_STRUCTURES TERRAIN_MASK_WALL FIND_SOURCES FIND_MINERALS */

declare global {
	interface Room {
		roomPlanner: RoomPlanner,
	}

	interface RoomMemory {
		roomPlanner?: any,
	}

	interface RoomPosition {
		isIrrelevant?: boolean,
		isRelevant?: boolean,
	}
}

import cache from 'utils/cache';
import hivemind from 'hivemind';
import RoomPlan from 'room/planner/room-plan';
import RoomPlanGenerator from 'room/planner/room-plan-generator';
import utilities from 'utilities';
import {getRoomPlanFor, setRoomPlanFor} from 'room/planner/room-plan-management';

// The room plan process is recreated every tick, but room plan generators
// are persistent in heap.
const generatorCache: {
	[roomName: string]: RoomPlanGenerator;
} = {};

function getGenerator(roomName: string): RoomPlanGenerator {
	return generatorCache[roomName];
}

function setGenerator(roomName, generator: RoomPlanGenerator) {
	generatorCache[roomName] = generator;
}

export default class RoomPlanner {

	activeRoomPlan: RoomPlan;
	activeRoomPlanVersion: number;
	generator: RoomPlanGenerator;
	roomPlannerVersion: number;
	roomName: string;
	room: Room;
	memory: {
		drawDebug: number;
		lastRun: number;
		adjacentSafe: {
			[direction: string]: boolean;
		};
		adjacentSafeRooms: string[];
	};
	buildingMatrix: CostMatrix;
	terrain: RoomTerrain;
	safetyMatrix: CostMatrix;
	exitTiles;
	wallDistanceMatrix: CostMatrix;
	exitDistanceMatrix: CostMatrix;
	roads: RoomPosition[];
	roomCenter: RoomPosition;
	roomCenterEntrances: RoomPosition[];
	openList;
	closedList;
	currentBuildSpot;

	/**
	 * Creates a room layout and makes sure the room is built accordingly.
	 * @constructor
	 *
	 * @param {string} roomName
	 *   Name of the room this room planner is assigned to.
	 */
	constructor(roomName: string) {
		this.roomPlannerVersion = 35;
		this.roomName = roomName;
		const activeInfo = getRoomPlanFor(roomName);
		this.activeRoomPlan = activeInfo.plan;
		this.activeRoomPlanVersion = activeInfo.version;
		this.room = Game.rooms[roomName]; // Will not always be available.

		const key = 'planner:' + roomName;
		if (!hivemind.segmentMemory.has(key)) {
			hivemind.segmentMemory.set(key, {});
		}

		this.memory = hivemind.segmentMemory.get(key);

		this.generator = getGenerator(roomName);
		if (this.generator) {
			this.generator.visualize();
		}
		if (this.activeRoomPlan && (this.memory.drawDebug || 0) > 0) {
			this.memory.drawDebug--;
			this.activeRoomPlan.visualize();
		}
	};

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
	};

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
		if (Game.cpu.getUsed() >= Game.cpu.tickLimit / 2) return;

		this.generator.generate();
	}

	applyGeneratedRoomPlan() {
		this.activeRoomPlan = this.generator.getRoomPlan();
		setRoomPlanFor(this.roomName, this.activeRoomPlan, this.roomPlannerVersion);
		hivemind.log('rooms', this.roomName).info('Stored room plan for room ' + this.roomName);
		delete this.generator;
		setGenerator(this.roomName, null);

		// Reset harvest position info for harvesters in case they are not correctly
		// assigned any more.
		if (this.room) {
			_.each(this.room.creepsByRole.harvester, creep => {
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

		const newStatus = hivemind.roomIntel(this.roomName).calculateAdjacentRoomSafety();
		this.memory.adjacentSafeRooms = newStatus.safeRooms;

		// Check if status changed since last check.
		for (const dir in newStatus.directions) {
			if (newStatus.directions[dir] !== this.memory.adjacentSafe[dir]) {
				// Status has changed, recalculate building positioning.
				hivemind.log('room plan', this.roomName).debug('changed adjacent room status!');
				Game.notify(
					'🛡 Exit safety has changed for room ' + this.room.name + '!\n\n' +
					'N: ' + (this.memory.adjacentSafe.N ? 'safe' : 'not safe') + ' -> ' + (newStatus.directions.N ? 'safe' : 'not safe') + '\n' +
					'E: ' + (this.memory.adjacentSafe.E ? 'safe' : 'not safe') + ' -> ' + (newStatus.directions.E ? 'safe' : 'not safe') + '\n' +
					'S: ' + (this.memory.adjacentSafe.S ? 'safe' : 'not safe') + ' -> ' + (newStatus.directions.S ? 'safe' : 'not safe') + '\n' +
					'W: ' + (this.memory.adjacentSafe.W ? 'safe' : 'not safe') + ' -> ' + (newStatus.directions.W ? 'safe' : 'not safe') + '\n'
				);

				this.startRoomPlanGeneration();

				this.memory.adjacentSafe = newStatus.directions;
				break;
			}
		}
	};

	/**
	 * Gets list of safe neighboring rooms.
	 *
	 * @return {string[]}
	 *   An array of room names.
	 */
	getAdjacentSafeRooms(): string[] {
		return this.memory.adjacentSafeRooms || [];
	};

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
	};

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
	};

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
	};

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
	};

	/**
	 * Gets a cost matrix representing this room when it's fully built.
	 *
	 * @return {PathFinder.CostMatrix}
	 *   The requested cost matrix.
	 */
	getNavigationMatrix(): CostMatrix {
		return cache.inHeap('plannerCostMatrix:' + this.roomName, 500, () => {
			const matrix = new PathFinder.CostMatrix();

			for (const locationType of this.activeRoomPlan.getPositionTypes()) {
				if (!['road', 'harvester', 'bay_center'].includes(locationType) && !(OBSTACLE_OBJECT_TYPES as string[]).includes(locationType)) continue;

				for (const pos of this.activeRoomPlan.getPositions(locationType)) {
					if (locationType === 'road') {
						if (matrix.get(pos.x, pos.y) === 0) {
							matrix.set(pos.x, pos.y, 1);
						}
					}
					else {
						matrix.set(pos.x, pos.y, 255);
					}
				}
			}

			return matrix;
		});
	};
}
