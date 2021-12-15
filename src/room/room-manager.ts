/* global Structure STRUCTURE_ROAD STRUCTURE_WALL STRUCTURE_SPAWN
STRUCTURE_CONTAINER STRUCTURE_TOWER STRUCTURE_EXTENSION STRUCTURE_RAMPART
STRUCTURE_TERMINAL STRUCTURE_STORAGE STRUCTURE_EXTRACTOR STRUCTURE_LAB
STRUCTURE_NUKER STRUCTURE_POWER_SPAWN STRUCTURE_OBSERVER LOOK_STRUCTURES
LOOK_CONSTRUCTION_SITES CONSTRUCTION_COST CREEP_LIFE_TIME MAX_CONSTRUCTION_SITES
FIND_STRUCTURES CONTROLLER_STRUCTURES FIND_HOSTILE_STRUCTURES OK STRUCTURE_LINK
FIND_MY_CONSTRUCTION_SITES */

declare global {
	interface Structure {
		needsDismantling,
	}

	interface Room {
		roomManager: RoomManager,
	}

	interface RoomMemory {
		manager: RoomManagerMemory,
	}

	interface RoomManagerMemory {
		runNextTick: boolean,
		hasMisplacedSpawn: boolean,
		dismantle: {[structureId: string]: number},
	}
}

import cache from 'utils/cache';
import hivemind from 'hivemind';
import {serializeCoords} from 'utils/serialization';

export default class RoomManager {
	room: Room;
	roomPlanner;
	memory: RoomManagerMemory;
	roomConstructionSites: ConstructionSite[];
	constructionSitesByType: {
		[key: string]: ConstructionSite[],
	};
	roomStructures: Structure[];
	structuresByType: {
		[key: string]: Structure[],
	};
	newStructures: number;

	/**
	 * Creates a new RoomManager object.
	 *
	 * @param {Room} room
	 *   The room to manage.
	 */
	constructor(room: Room) {
		this.room = room;
		this.roomPlanner = room.roomPlanner;
		this.initializeMemory();
	}

	initializeMemory() {
		if (!Memory.rooms[this.room.name]) {
			Memory.rooms[this.room.name] = {} as RoomMemory;
		}

		if (!Memory.rooms[this.room.name].manager) {
			Memory.rooms[this.room.name].manager = {
				dismantle: {},
				runNextTick: false,
				hasMisplacedSpawn: false,
			};
		}

		this.memory = Memory.rooms[this.room.name].manager;
	}

	/**
	 * Determines if the RoomManager needs to run immediately.
	 *
	 * @return {boolean}
	 *   True to ignore normal throttling.
	 */
	shouldRunImmediately() {
		return this.memory.runNextTick;
	}

	/**
	 * Manages the assigned room.
	 */
	runLogic() {
		if (!this.roomPlanner || !this.roomPlanner.isPlanningFinished()) return;

		delete this.memory.runNextTick;
		this.roomConstructionSites = this.room.find(FIND_MY_CONSTRUCTION_SITES);
		this.constructionSitesByType = _.groupBy(this.roomConstructionSites, 'structureType');
		this.roomStructures = this.room.find(FIND_STRUCTURES);
		this.structuresByType = _.groupBy(this.roomStructures, 'structureType');
		this.newStructures = 0;

		this.cleanRoom();
		this.manageStructures();
	}

	/**
	 * Removes structures that might prevent the room's construction.
	 */
	cleanRoom() {
		// Remove all roads not part of current room plan.
		for (const road of this.structuresByType[STRUCTURE_ROAD] || []) {
			if (!this.roomPlanner.isPlannedLocation(road.pos, 'road') && !this.getOperationRoadPositions()[serializeCoords(road.pos.x, road.pos.y)]) {
				road.destroy();
			}
		}

		// Remove all extensions and labs blocking roads (from redesigning rooms).
		for (const extension of this.structuresByType[STRUCTURE_EXTENSION] || []) {
			if (this.roomPlanner.isPlannedLocation(extension.pos, 'extension')) continue;
			if (!this.roomPlanner.isPlannedLocation(extension.pos, 'road')) continue;

			extension.destroy();
		}
		for (const lab of this.structuresByType[STRUCTURE_LAB] || []) {
			if (this.roomPlanner.isPlannedLocation(lab.pos, 'lab')) continue;
			if (!this.roomPlanner.isPlannedLocation(lab.pos, 'road')) continue;

			lab.destroy();
		}

		// Remove unwanted walls that might block initial buildings.
		for (const wall of this.structuresByType[STRUCTURE_WALL] || []) {
			if (
				this.roomPlanner.isPlannedLocation(wall.pos, 'road') ||
				this.roomPlanner.isPlannedLocation(wall.pos, 'harvester') ||
				this.roomPlanner.isPlannedLocation(wall.pos, 'spawn') ||
				this.roomPlanner.isPlannedLocation(wall.pos, 'storage') ||
				this.roomPlanner.isPlannedLocation(wall.pos, 'extension')
			) {
				wall.destroy();
			}
		}

		// Remove hostile structures.
		for (const structure of this.room.find(FIND_HOSTILE_STRUCTURES)) {
			structure.destroy();
		}
	}

	getOperationRoadPositions(): {[location: number]: RoomPosition} {
		return cache.inHeap('opRoads:' + this.room.name, 100, () => {
			const positions = {};

			for (const operationName in Game.operationsByType.mining || []) {
				const operation = Game.operationsByType.mining[operationName];

				const locations = operation.getMiningLocationsByRoom();
				if (!locations[this.room.name]) continue;

				const paths = operation.getPaths();
				for (const sourceLocation of locations[this.room.name]) {
					for (const position of paths[sourceLocation].path) {
						if (position.roomName === this.room.name) positions[serializeCoords(position.x, position.y)] = position;
					}
				}
			}

			return positions;
		});
	}

	/**
	 * Makes sure structures are built and removed as intended.
	 */
	manageStructures() {
		if (_.size(Game.spawns) === 1 && _.sample(Game.spawns).room.name === this.room.name && this.room.controller.level < 4) {
			// In our first room, getting more extensions is pretty important for
			// spawning bigger creeps asap.
			if (this.room.controller.level >= 3) {
				// We can now build extensions near energy sources, since harvesters are now
				// big enough that one will be able to harvest all available energy.
				this.buildPlannedStructures('extension.harvester', STRUCTURE_EXTENSION);
			}

			this.buildPlannedStructures('extension.bay', STRUCTURE_EXTENSION);
		}

		// Make sure all current spawns have been built.
		const roomSpawns = this.structuresByType[STRUCTURE_SPAWN] || [];
		const roomSpawnSites = this.constructionSitesByType[STRUCTURE_SPAWN] || [];

		// Make sure spawns are built in the right place, remove otherwise.
		delete this.memory.hasMisplacedSpawn;
		if (roomSpawns.length >= CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][this.room.controller.level] && this.roomConstructionSites.length === 0) {
			if (this.removeMisplacedSpawn(roomSpawns)) return;
		}
		else if (roomSpawns.length + roomSpawnSites.length < CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][this.room.controller.level]) {
			this.buildPlannedStructures('spawn', STRUCTURE_SPAWN);
		}

		this.buildPlannedStructures('wall.blocker', STRUCTURE_WALL);

		// Build road to sources asap to make getting energy easier.
		this.buildPlannedStructures('road.source', STRUCTURE_ROAD);

		// Build road to controller for easier upgrading.
		this.buildPlannedStructures('road.controller', STRUCTURE_ROAD);

		if (this.room.controller.level === 0) {
			// If we're waiting for a claim, busy ourselves by building roads.
			this.buildPlannedStructures('road', STRUCTURE_ROAD);
			this.buildOperationRoads();
		}

		if (this.room.controller.level < 2) return;

		// At level 2, we can start building containers at sources and controller.
		this.removeUnplannedStructures('container', STRUCTURE_CONTAINER);
		this.buildPlannedStructures('container.source', STRUCTURE_CONTAINER);
		this.buildPlannedStructures('container.controller', STRUCTURE_CONTAINER);

		// Make sure towers are built in the right place, remove otherwise.
		this.removeUnplannedStructures('tower', STRUCTURE_TOWER, 1);
		this.buildPlannedStructures('tower', STRUCTURE_TOWER);

		// Build storage ASAP.
		if (this.hasMisplacedStorage() && this.room.storage.store.getUsedCapacity() < 5000) {
			this.removeUnplannedStructures('storage', STRUCTURE_STORAGE, 1);
		}
		this.buildPlannedStructures('storage', STRUCTURE_STORAGE);

		// Make sure extensions are built in the right place, remove otherwise.
		this.removeUnplannedStructures('extension', STRUCTURE_EXTENSION, 1);
		if (this.room.controller.level >= 3) {
			// We can now build extensions near energy sources, since harvesters are now
			// big enough that one will be able to harvest all available energy.
			this.buildPlannedStructures('extension.harvester', STRUCTURE_EXTENSION);
		}

		this.buildPlannedStructures('extension.bay', STRUCTURE_EXTENSION);
		this.buildPlannedStructures('extension', STRUCTURE_EXTENSION);

		// Also build terminal when available.
		if (this.hasMisplacedTerminal() && this.room.terminal.store.getUsedCapacity() < 5000) {
			this.removeUnplannedStructures('terminal', STRUCTURE_TERMINAL, 1);
		}
		this.buildPlannedStructures('terminal', STRUCTURE_TERMINAL);

		// Make sure links are built in the right place, remove otherwise.
		this.removeUnplannedStructures('link', STRUCTURE_LINK, 1);
		this.buildPlannedStructures('link.controller', STRUCTURE_LINK);
		// @todo Build link to farthest locations first.
		this.buildPlannedStructures('link.source', STRUCTURE_LINK);
		this.buildPlannedStructures('link.storage', STRUCTURE_LINK);
		this.buildPlannedStructures('link', STRUCTURE_LINK);

		// Build extractor and related container if available.
		if (CONTROLLER_STRUCTURES[STRUCTURE_EXTRACTOR][this.room.controller.level] > 0) {
			this.buildPlannedStructures('extractor', STRUCTURE_EXTRACTOR);
			this.buildPlannedStructures('container.mineral', STRUCTURE_CONTAINER);
		}

		if (this.room.controller.level < 4) return;

		// Make sure all requested ramparts are built.
		this.buildPlannedStructures('rampart', STRUCTURE_RAMPART);

		// Slate all unmanaged walls and ramparts for deconstruction.
		const unwantedDefenses = this.room.find(FIND_STRUCTURES, {
			filter: structure => {
				if (structure.structureType === STRUCTURE_WALL && !this.roomPlanner.isPlannedLocation(structure.pos, 'wall')) return true;
				if (structure.structureType === STRUCTURE_RAMPART && !this.roomPlanner.isPlannedLocation(structure.pos, 'rampart')) return true;

				return false;
			},
		});
		for (const structure of unwantedDefenses) {
			this.memory.dismantle[structure.id] = 1;
		}

		// At level 4, we can build all remaining roads.
		this.buildPlannedStructures('road', STRUCTURE_ROAD);

		// Further constructions should only happen in safe rooms.
		if (this.room.isEvacuating()) return;
		if (!this.checkWallIntegrity()) return;

		this.buildEndgameStructures();
	}

	/**
	 * Try placing construction sites of the given type at all locations.
	 *
	 * @param {string} locationType
	 *   The type of location that should be checked.
	 * @param {string} structureType
	 *   The type of structure to place.
	 *
	 * @return {boolean}
	 *   True if we can continue building.
	 */
	buildPlannedStructures(locationType: string, structureType: StructureConstant): boolean {
		let canBuildMore = true;
		for (const pos of this.roomPlanner.getLocations(locationType)) {
			if (this.tryBuild(pos, structureType)) continue;

			canBuildMore = false;
			break;
		}

		return canBuildMore;
	}

	buildOperationRoads() {
		const positions = this.getOperationRoadPositions();
		for (const pos of _.values(positions)) {
			if (this.tryBuild(pos, STRUCTURE_ROAD)) continue;

			break;
		}
	}

	/**
	 * Tries to place a construction site.
	 *
	 * @param {RoomPosition} pos
	 *   The position at which to place the structure.
	 * @param {string} structureType
	 *   The type of structure to place.
	 *
	 * @return {boolean}
	 *   True if we can continue building.
	 */
	tryBuild(pos, structureType) {
		// Check if there's a structure here already.
		const structures = pos.lookFor(LOOK_STRUCTURES);
		for (const i in structures) {
			if (structures[i].structureType === structureType) {
				// Structure is here, continue.
				return true;
			}
		}

		// Check if there's a construction site here already.
		const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
		for (const i in sites) {
			if (sites[i].structureType === structureType) {
				// Structure is being built, continue.
				return true;
			}
		}

		const canCreateMoreSites = this.newStructures + this.roomConstructionSites.length < 5;
		if (canCreateMoreSites && _.size(Game.constructionSites) < MAX_CONSTRUCTION_SITES * 0.9) {
			if (pos.createConstructionSite(structureType) === OK) {
				this.newStructures++;
				// Structure is being built, continue.
				return true;
			}

			// Some other structure is blocking or we can't build more of this structure.
			// Building logic should continue for now.
			return true;
		}

		// We can't build anymore in this room right now.
		return false;
	}

	/**
	 * Removes misplaced spawns for rebuilding at a new location.
	 *
	 * @param {StructureSpawn[]} roomSpawns
	 *   List of spawns in the room.
	 *
	 * @return {boolean}
	 *   True if a spawn was destroyed this tick.
	 */
	removeMisplacedSpawn(roomSpawns) {
		for (const spawn of roomSpawns) {
			if (this.roomPlanner.isPlannedLocation(spawn.pos, 'spawn')) continue;

			// Only destroy spawn if there are enough resources and builders available.
			const roomEnergy = this.room.storage ? this.room.storage.store.energy : 0;
			const resourcesAvailable = (roomEnergy > CONSTRUCTION_COST[STRUCTURE_SPAWN] * 2 && _.size(this.room.creepsByRole.builder) > 1);
			if (!resourcesAvailable && _.size(roomSpawns) === 1) return false;

			// This spawn is misplaced, set a flag for spawning more builders to help.
			if (roomEnergy > CONSTRUCTION_COST[STRUCTURE_SPAWN] * 3) {
				this.memory.hasMisplacedSpawn = true;
			}

			// Don't check whether spawn can be moved right now if a creep is spawning.
			if (spawn.spawning) continue;

			let buildPower = 0;
			for (const creep of _.values<Creep>(this.room.creepsByRole.builder)) {
				if (creep.ticksToLive) {
					buildPower += creep.memory.body.work * creep.ticksToLive / CREEP_LIFE_TIME;
				}
			}

			if (buildPower > 15) {
				spawn.destroy();
				this.memory.runNextTick = true;
				// Only kill of one spawn at a time, it should be rebuilt right away next tick!
				return true;
			}
		}

		return false;
	}

	/**
	 * Checks if the room has a spawn at the wrong location.
	 *
	 * @return {boolean}
	 *   True if a spawn needs to be moved.
	 */
	hasMisplacedSpawn(): boolean {
		return this.memory.hasMisplacedSpawn;
	}

	/**
	 * Checks if the room has a storage at the wrong location.
	 *
	 * @return {boolean}
	 *   True if a storage needs to be moved.
	 */
	hasMisplacedStorage(): boolean {
		if (!this.room.storage) return false;
		if (!this.roomPlanner) return false;
		if (this.roomPlanner.isPlannedLocation(this.room.storage.pos, 'storage')) return false;

		return true;
	}

	/**
	 * Checks if the room has a terminal at the wrong location.
	 *
	 * @return {boolean}
	 *   True if a terminal needs to be moved.
	 */
	hasMisplacedTerminal(): boolean {
		if (!this.room.terminal) return false;
		if (!this.roomPlanner) return false;
		if (this.roomPlanner.isPlannedLocation(this.room.terminal.pos, 'terminal')) return false;

		return true;
	}

	/**
	 * Remove structures that are not part of the current building plan.
	 *
	 * @param {string} locationType
	 *   The type of location that should be checked.
	 * @param {string} structureType
	 *   The type of structure to remove.
	 * @param {number} amount
	 *   Maximum number of structures to remove during a single tick.
	 */
	removeUnplannedStructures(locationType, structureType, amount?: number) {
		const structures = this.structuresByType[structureType] || [];
		const sites = this.constructionSitesByType[structureType] || [];

		let limit = Math.min(CONTROLLER_STRUCTURES[structureType][this.room.controller.level], _.size(this.room.roomPlanner.getLocations(locationType)));
		if (amount) {
			limit = amount + structures.length + sites.length - limit;
		}

		let count = 0;
		for (const structure of structures) {
			if (!this.roomPlanner.isPlannedLocation(structure.pos, locationType)) {
				if (count < limit) {
					structure.destroy();
					count++;
				}
				else break;
			}
		}
	}

	/**
	 * Checks if all ramparts in the room have at least 500.000 hits.
	 *
	 * @return {boolean}
	 *   True if walls are considered complete.
	 */
	checkWallIntegrity() {
		for (const pos of this.roomPlanner.getLocations('rampart')) {
			// Check if there's a rampart here already.
			const structures: AnyStructure[] = pos.lookFor(LOOK_STRUCTURES);
			if (_.filter(structures, structure => structure.structureType === STRUCTURE_RAMPART && structure.hits >= hivemind.settings.get('minWallIntegrity')).length === 0) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Builds structures that are relevant in fully built rooms only.
	 */
	buildEndgameStructures() {
		if (hivemind.settings.get('constructLabs')) {
			// Make sure labs are built in the right place, remove otherwise.
			this.removeUnplannedStructures('lab', STRUCTURE_LAB, 1);
			if (CONTROLLER_STRUCTURES[this.room.controller.level] === 3) {
				// Build reaction labs first if we only have enough to start reactions.
				this.buildPlannedStructures('lab.reaction', STRUCTURE_LAB);
			}
			else {
				// Build boost lab with priority.
				this.buildPlannedStructures('lab.boost', STRUCTURE_LAB);

				// Build remaining labs.
				this.buildPlannedStructures('lab', STRUCTURE_LAB);
			}
		}

		if (hivemind.settings.get('constructNukers')) {
			// Make sure all current nukers have been built.
			if (_.size(this.roomConstructionSites) === 0) this.removeUnplannedStructures('nuker', STRUCTURE_NUKER, 1);
			this.buildPlannedStructures('nuker', STRUCTURE_NUKER);
		}

		if (hivemind.settings.get('constructPowerSpawns')) {
			// Make sure all current power spawns have been built.
			if (_.size(this.roomConstructionSites) === 0) this.removeUnplannedStructures('powerSpawn', STRUCTURE_POWER_SPAWN, 1);
			this.buildPlannedStructures('powerSpawn', STRUCTURE_POWER_SPAWN);
		}

		if (hivemind.settings.get('constructObservers')) {
			// Make sure all current observers have been built.
			if (_.size(this.roomConstructionSites) === 0) this.removeUnplannedStructures('observer', STRUCTURE_OBSERVER, 1);
			this.buildPlannedStructures('observer', STRUCTURE_OBSERVER);
		}
	}

	/**
	 * Decides whether a dismantler is needed in the current room.
	 *
	 * @return {boolean}
	 *   True if a dismantler should be spawned.
	 */
	needsDismantling() {
		return _.size(this.memory.dismantle) > 0;
	}

	/**
	 * Decides on a structure that needs to be dismantled.
	 *
	 * @return {Structure}
	 *   The next structure to dismantle.
	 */
	getDismantleTarget() {
		if (!this.needsDismantling()) return null;

		for (const id of _.keys(this.memory.dismantle)) {
			const structure = Game.getObjectById<AnyOwnedStructure>(id);
			if (!structure) {
				delete this.memory.dismantle[id];
				continue;
			}

			// If there's a rampart on it, dismantle the rampart first if requested, or just destroy the building immediately.
			const structures = structure.pos.lookFor(LOOK_STRUCTURES);
			let innocentRampartFound = false;
			for (const i in structures) {
				if (structures[i].structureType === STRUCTURE_RAMPART) {
					if (this.memory.dismantle[structures[i].id]) {
						return structures[i];
					}

					structure.destroy();
					innocentRampartFound = true;
					break;
				}
			}

			if (!innocentRampartFound) {
				return structure;
			}
		}

		return null;
	}
};

/**
 * Decides whether a structure is supposed to be dismantled.
 *
 * @return {boolean}
 *   True if the structure should be dismantled.
 */
Structure.prototype.needsDismantling = function () {
	if (!this.room.roomManager || !this.room.roomManager.needsDismantling()) return false;

	if (this.room.roomManager.memory.dismantle && this.room.roomManager.memory.dismantle[this.id]) {
		return true;
	}

	return false;
};
