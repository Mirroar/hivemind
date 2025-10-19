/* global Structure STRUCTURE_ROAD STRUCTURE_WALL STRUCTURE_SPAWN
STRUCTURE_CONTAINER STRUCTURE_TOWER STRUCTURE_EXTENSION STRUCTURE_RAMPART
STRUCTURE_TERMINAL STRUCTURE_STORAGE STRUCTURE_EXTRACTOR STRUCTURE_LAB
STRUCTURE_NUKER STRUCTURE_POWER_SPAWN STRUCTURE_OBSERVER LOOK_STRUCTURES
LOOK_CONSTRUCTION_SITES CONSTRUCTION_COST CREEP_LIFE_TIME MAX_CONSTRUCTION_SITES
CONTROLLER_STRUCTURES FIND_HOSTILE_STRUCTURES OK STRUCTURE_LINK
FIND_MY_CONSTRUCTION_SITES */

import cache from 'utils/cache';
import hivemind from 'hivemind';
import PersistentFeatureFlag from 'utils/persistent-feature-flag';
import RemoteMiningOperation from 'operation/remote-mining';
import RoomPlanner from 'room/planner/room-planner';
import {ENEMY_STRENGTH_NONE} from 'room-defense';
import {serializeCoords} from 'utils/serialization';

declare global {
	interface Structure {
		needsDismantling: () => boolean;
	}

	interface Room {
		roomManager: RoomManager;
	}

	interface RoomMemory {
		manager: RoomManagerMemory;
	}

	interface RoomManagerMemory {
		runNextTick: boolean;
		hasMisplacedSpawn: boolean;
		isMovingMisplacedSpawn: boolean;
		dismantle: Record<string, number>;
	}
}

interface ScoredExtractorPosition {
	position: RoomPosition;
	hasExtractor: boolean;
	score: number;
	mineralType?: MineralConstant;
}

type RoomManagerFeatureFlag = 'finishedRecovering' | 'cleanedRoom' | 'builtAllStructures' | 'ranAtRcl'; 

export default class RoomManager {
	room: Room;
	roomPlanner: RoomPlanner;
	memory: RoomManagerMemory;
	featureFlags: PersistentFeatureFlag<RoomManagerFeatureFlag>;
	roomConstructionSites: ConstructionSite[];
	constructionSitesByType: Record<string, ConstructionSite[]>;

	roomStructures: Structure[];
	structuresByType: Record<string, Structure[]>;

	newStructures: number;
	lastDecayCheck: number = 0;

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
				isMovingMisplacedSpawn: false,
			};
		}

		this.memory = Memory.rooms[this.room.name].manager;

		this.featureFlags = new PersistentFeatureFlag<RoomManagerFeatureFlag>('room:managerFlags:' + this.room.name);
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
		delete this.memory.runNextTick;
		if (!this.roomPlanner) return;
		if (!this.roomPlanner.isPlanningFinished()) {
			// Make sure to reset feature flags when room planner is running.
			this.featureFlags.reset();

			return;
		}

		if (this.room.defense.getEnemyStrength() > ENEMY_STRENGTH_NONE && !this.room.controller?.safeMode) {
			// Don't build anything while under attack from anything but NPC Invaders.
			// Reset feature flags to make sure we rebuild everything once the threat is gone.
			// @todo Actually we do still want to place construction sites for walls and ramparts.
			this.featureFlags.reset();

			if (!this.room.defense.getEnemyInfo().invaderOnly) return;
		}

		// Figure out if rcl has changed and we need to build some new structures.
		if (this.room.controller.level !== this.featureFlags.getNumeric('ranAtRcl')) {
			this.featureFlags.reset();
			this.featureFlags.setNumeric('ranAtRcl', this.room.controller.level);
		}

		if (this.featureFlags.isSet('builtAllStructures') && !this.memory.isMovingMisplacedSpawn && !this.memory.hasMisplacedSpawn) {
			// Figure out if a road, container or rampart has decayed and needs rebuilding.
			this.periodicallyCheckDecayingStructures();

			// Otherwise, we're done here.
			return;
		}

		this.initializeStructureInformation();

		if (this.recoverRoom()) return;
		this.cleanRoom();
		this.manageStructures();

		// If there's nothing more to build, we're done.
		if (this.checkWallIntegrity() && this.roomConstructionSites.length + this.newStructures === 0) {
			this.featureFlags.set('builtAllStructures');
		}
	}

	periodicallyCheckDecayingStructures() {
		// We only need to check decaying structures if the room is fully built.
		if (!this.featureFlags.isSet('builtAllStructures')) return;
		if (!hivemind.hasIntervalPassed(CREEP_LIFE_TIME, this.lastDecayCheck)) return;
		
		this.lastDecayCheck = Game.time;
		this.initializeStructureInformation();
		this.checkDecayedRoomPlanStructures();
		this.buildOperationRoads();
	}

	checkDecayedRoomPlanStructures() {
		if (this.room.controller.level >= 6) {
			this.buildPlannedStructures('container', STRUCTURE_CONTAINER);
		}
		else if (this.room.controller.level >= 2) {
			this.buildPlannedStructures('container.source', STRUCTURE_CONTAINER);
			this.buildPlannedStructures('container.controller', STRUCTURE_CONTAINER);
		}

		if (this.room.controller.level < 4) return;
		this.buildPlannedStructures('rampart', STRUCTURE_RAMPART);
		this.buildPlannedStructures('road', STRUCTURE_ROAD);
	}

	initializeStructureInformation() {
		this.newStructures = 0;
		this.roomConstructionSites = this.room.find(FIND_MY_CONSTRUCTION_SITES);
		this.constructionSitesByType = _.groupBy(this.roomConstructionSites, 'structureType');
		this.roomStructures = this.room.structures;
		this.structuresByType = this.room.structuresByType;
	}

	recoverRoom(): boolean {
		if (this.featureFlags.isSet('finishedRecovering')) return false;
		if (!this.isRoomRecovering()) {
			this.featureFlags.set('finishedRecovering');
			return false;
		}

		this.buildRoomDefenseFirst();

		if (!this.structuresByType[STRUCTURE_SPAWN] || this.structuresByType[STRUCTURE_SPAWN].length === 0) return true;
		if (CONTROLLER_STRUCTURES[STRUCTURE_STORAGE][this.room.controller.level] > 0 && (!this.structuresByType[STRUCTURE_STORAGE] || this.structuresByType[STRUCTURE_STORAGE].length === 0)) return true;

		this.featureFlags.set('finishedRecovering');
		return false;
	}

	isRoomRecovering(): boolean {
		if ((this.room.controller.safeMode ?? 0) > 5000) return false;
		if (this.room.needsReclaiming()) return true;

		if (this.structuresByType[STRUCTURE_SPAWN] && this.structuresByType[STRUCTURE_SPAWN].length > 0) return false;
		if (this.room.controller.level < 3) return false;

		return true;
	}

	buildRoomDefenseFirst() {
		for (let i = 0; i < CONTROLLER_STRUCTURES[STRUCTURE_TOWER][this.room.controller.level]; i++) {
			// Build ramparts at tower spots.
			this.buildPlannedStructures(`tower.${i}`, STRUCTURE_RAMPART, pos => this.roomPlanner.isPlannedLocation(pos, 'tower'));
			this.buildPlannedStructures(`tower.${i}`, STRUCTURE_TOWER, pos => this.roomPlanner.isPlannedLocation(pos, 'tower'));
		}

		// If for some reason other tower are not in numbered spots, build them anyway.
		this.buildPlannedStructures('tower', STRUCTURE_TOWER);

		// Build normal ramparts.
		this.buildPlannedStructures('rampart', STRUCTURE_RAMPART, pos => !this.roomPlanner.isPlannedLocation(pos, 'rampart.ramp'));

		// Build spawn once we have enough capacity for decently sized creeps.
		if (this.checkWallIntegrity(10_000)) {
			const creepCost = (6 * BODYPART_COST[WORK]) + (3 * BODYPART_COST[MOVE]) + (3 * BODYPART_COST[CARRY]);
			if (this.room.energyCapacityAvailable + SPAWN_ENERGY_CAPACITY < creepCost) {
				this.manageExtensions();
			}

			this.buildPlannedStructures('spawn.0', STRUCTURE_SPAWN);
			this.buildPlannedStructures('container.source', STRUCTURE_CONTAINER);
			this.buildPlannedStructures('storage', STRUCTURE_STORAGE);
		}
	}

	canCreateConstructionSites() {
		return this.newStructures + this.roomConstructionSites.length < 5;
	}

	/**
	 * Removes structures that might prevent the room's construction.
	 */
	cleanRoom() {
		if (this.featureFlags.isSet('cleanedRoom')) return;

		this.removeHostileStructures();
		this.removeHostileConstructionSites();
		
		if (!this.room.roomPlanner?.hasRoomPlan()) return;

		this.cleanExtensions();
		this.cleanLabs();
		this.cleanLinks();
		this.cleanWalls();
		this.featureFlags.set('cleanedRoom');
	}

	cleanExtensions() {
		for (const extension of this.structuresByType[STRUCTURE_EXTENSION] || []) {
			// Don't remove planned extensions.
			// Unless they're not operational due to downgrade. That tends to
			// mess up `room.energyAvailable` so often that we can easily get spawn-locked.
			// We'd rather destroy and rebuild them in that case.
			if (this.roomPlanner.isPlannedLocation(extension.pos, 'extension') && extension.isOperational()) continue;
			if (!this.roomPlanner.isPlannedLocation(extension.pos, 'road') && extension.isOperational()) continue;

			extension.destroy();
		}
	}

	cleanLabs() {
		for (const lab of this.structuresByType[STRUCTURE_LAB] || []) {
			if (this.roomPlanner.isPlannedLocation(lab.pos, 'lab')) continue;
			if (
				!this.roomPlanner.isPlannedLocation(lab.pos, 'road')
				&& !this.roomPlanner.isPlannedLocation(lab.pos, 'spawn')
				&& !this.roomPlanner.isPlannedLocation(lab.pos, 'link')
				&& !this.roomPlanner.isPlannedLocation(lab.pos, 'extension')
			) continue;

			lab.destroy();
		}
	}

	cleanLinks() {
		for (const link of this.structuresByType[STRUCTURE_LINK] || []) {
			if (this.roomPlanner.isPlannedLocation(link.pos, 'link')) continue;
			if (
				!this.roomPlanner.isPlannedLocation(link.pos, 'road')
				&& !this.roomPlanner.isPlannedLocation(link.pos, 'spawn')
				&& !this.roomPlanner.isPlannedLocation(link.pos, 'link')
				&& !this.roomPlanner.isPlannedLocation(link.pos, 'extension')
			) continue;

			link.destroy();
		}
	}

	cleanWalls() {
		for (const wall of this.structuresByType[STRUCTURE_WALL] || []) {
			if (
				this.roomPlanner.isPlannedLocation(wall.pos, 'road')
				|| this.roomPlanner.isPlannedLocation(wall.pos, 'harvester')
				|| this.roomPlanner.isPlannedLocation(wall.pos, 'spawn')
				|| this.roomPlanner.isPlannedLocation(wall.pos, 'storage')
				|| this.roomPlanner.isPlannedLocation(wall.pos, 'extension')
			) {
				wall.destroy();
			}
		}
	}

	removeHostileStructures() {
		for (const structure of this.room.find(FIND_HOSTILE_STRUCTURES)) {
			structure.destroy();
		}
	}

	removeHostileConstructionSites() {
		for (const site of this.room.find(FIND_CONSTRUCTION_SITES)) {
			if (site.my) continue;

			site.remove();
		}
	}

	getOperationRoadPositions(): Record<number, RoomPosition> {
		return cache.inHeap('opRoads:' + this.room.name, 100, () => {
			const positions = {};

			for (const operation of _.values<RemoteMiningOperation>(Game.operationsByType.mining)) {
				const locations = operation.getMiningLocationsByRoom();
				if (!locations[this.room.name]) continue;

				const paths = operation.getPaths();
				for (const sourceLocation of locations[this.room.name]) {
					for (const position of paths[sourceLocation]?.path || []) {
						if (position.roomName === this.room.name) positions[serializeCoords(position.x, position.y)] = position;
					}
				}
			}

			return positions;
		});
	}

	isOperationRoadPosition(position: RoomPosition): boolean {
		const positions = this.getOperationRoadPositions();
		if (positions[serializeCoords(position.x, position.y)]) return true;

		return false;
	}

	/**
	 * Makes sure structures are built and removed as intended.
	 */
	manageStructures() {
		if (_.size(Game.spawns) === 1 && _.sample(Game.spawns).room.name === this.room.name && this.room.controller.level < 4) {
			// In our first room, getting more extensions is pretty important for
			// spawning bigger creeps asap.
			this.manageExtensions();
		}

		if (!this.canCreateConstructionSites()) return;

		this.manageTowers();
		this.manageSpawns();
		this.buildPlannedStructures('wall.blocker', STRUCTURE_WALL);
		if (!this.canCreateConstructionSites()) return;

		if (this.room.controller.level === 0) {
			const terrain = this.room.getTerrain();

			// Build road to sources asap to make getting energy easier.
			this.buildPlannedStructures('road.source', STRUCTURE_ROAD, pos => terrain.get(pos.x, pos.y) === TERRAIN_MASK_SWAMP);

			// Build road to controller for easier upgrading.
			this.buildPlannedStructures('road.controller', STRUCTURE_ROAD, pos => terrain.get(pos.x, pos.y) === TERRAIN_MASK_SWAMP);

			// If we're waiting for a claim, busy ourselves by building roads.
			this.buildPlannedStructures('road', STRUCTURE_ROAD);
		}

		if (this.room.controller.level < 2) return;

		// Make sure enough extensions for reasonably sized creeps are built.
		if (this.room.energyCapacityAvailable < MAX_CREEP_SIZE * (BODYPART_COST[WORK] + BODYPART_COST[MOVE]) / 2) {
			this.manageExtensions();
			if (!this.canCreateConstructionSites()) return;
		}

		this.manageContainers();
		this.manageRamparts();
		if (!this.canCreateConstructionSites()) return;

		this.manageStorage();
		this.manageTerminal();

		if (this.room.storage || CONTROLLER_STRUCTURES[STRUCTURE_STORAGE][this.room.controller.level] === 0) {
			// At this point, only build roads on swamp tiles.
			const terrain = this.room.getTerrain();

			// Build road to sources asap to make getting energy easier.
			this.buildPlannedStructures('road.source', STRUCTURE_ROAD, pos => terrain.get(pos.x, pos.y) === TERRAIN_MASK_SWAMP);

			// Build road to controller for easier upgrading.
			this.buildPlannedStructures('road.controller', STRUCTURE_ROAD, pos => terrain.get(pos.x, pos.y) === TERRAIN_MASK_SWAMP);
		}

		if (!this.canCreateConstructionSites()) return;

		this.manageLinks();

		if (CONTROLLER_STRUCTURES[STRUCTURE_EXTRACTOR][this.room.controller.level] > 0) {
			this.manageExtractors();
			this.buildPlannedStructures('container.mineral', STRUCTURE_CONTAINER);
		}

		if (this.room.controller.level < 4) return;

		if (!this.canCreateConstructionSites()) return;

		this.dismantleUnwantedDefenses();

		// At level 4, we can build all remaining roads.
		if (this.room.storage) {
			this.buildPlannedStructures('road', STRUCTURE_ROAD);
			this.buildOperationRoads();
		}

		// Build any missing extensions.
		this.manageExtensions();

		// Further constructions should only happen in safe rooms.
		if (this.room.isEvacuating()) return;
		if (!this.checkWallIntegrity()) return;

		this.buildEndgameStructures();
		this.buildPlannedStructures('wall.deco', STRUCTURE_WALL);
	}

	manageTowers() {
		this.removeUnplannedStructures('tower', STRUCTURE_TOWER, 1);
		const maxTowers = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][this.room.controller.level];
		for (let i = 0; i < maxTowers; i++) {
			this.buildPlannedStructures(`tower.${i}`, STRUCTURE_TOWER, pos => this.roomPlanner.isPlannedLocation(pos, 'tower'));
		}

		this.buildPlannedStructures('tower', STRUCTURE_TOWER);
	}

	manageSpawns() {
		const roomSpawns = this.structuresByType[STRUCTURE_SPAWN] || [];
		const roomSpawnSites = this.constructionSitesByType[STRUCTURE_SPAWN] || [];

		delete this.memory.isMovingMisplacedSpawn;
		if (roomSpawns.length >= CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][this.room.controller.level] && this.roomConstructionSites.length === 0) {
			this.removeMisplacedSpawn(roomSpawns as StructureSpawn[]);
		}
		else if (roomSpawns.length + roomSpawnSites.length < CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][this.room.controller.level]) {
			for (let i = 0; i < CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][this.room.controller.level]; i++) {
				this.buildPlannedStructures(`spawn.${i}`, STRUCTURE_SPAWN, pos => this.roomPlanner.isPlannedLocation(pos, 'spawn'));
			}

			this.buildPlannedStructures('spawn', STRUCTURE_SPAWN);
		}
	}

	manageContainers() {
		this.removeUnplannedStructures('container', STRUCTURE_CONTAINER);
		this.buildPlannedStructures('container.source', STRUCTURE_CONTAINER);
		this.buildPlannedStructures('container.controller', STRUCTURE_CONTAINER);
	}

	manageRamparts() {
		// @todo We might be able to get away with not building ramparts as long as
		// we still have a safemode remaining, it's not on cooldown, and no other
		// room of ours is safemoded.
		const currentSafemode = this.room.controller.safeMode ?? 0;
		if (this.room.controller.level >= 3 && (currentSafemode < 2000 || this.room.controller.safeModeCooldown)) {
			// Make sure all requested main ramparts are built.
			this.buildPlannedStructures('rampart', STRUCTURE_RAMPART, pos => !this.roomPlanner.isPlannedLocation(pos, 'rampart.ramp'));

			// Make sure all on-ramps are built as well.
			this.buildPlannedStructures('rampart', STRUCTURE_RAMPART);
		}
	}

	manageStorage() {
		if (this.hasMisplacedStorage() && this.room.storage.store.getUsedCapacity() < 5000) {
			this.removeUnplannedStructures('storage', STRUCTURE_STORAGE, 1);
		}

		this.buildPlannedStructures('storage', STRUCTURE_STORAGE);
	}

	manageTerminal() {
		if (this.hasMisplacedTerminal() && this.room.terminal.store.getUsedCapacity() < 5000) {
			this.removeUnplannedStructures('terminal', STRUCTURE_TERMINAL, 1);
		}

		this.buildPlannedStructures('terminal', STRUCTURE_TERMINAL);
	}

	dismantleUnwantedDefenses() {
		this.memory.dismantle = {};
		if (!this.room.needsReclaiming()) {
			const unwantedWalls = _.filter(
				this.room.structuresByType[STRUCTURE_WALL],
				structure => !this.roomPlanner.isPlannedLocation(structure.pos, 'wall'),
			);
			const unwantedRamparts = hivemind.settings.get('dismantleUnwantedRamparts') ? _.filter(
				this.room.structuresByType[STRUCTURE_RAMPART],
				structure => !this.roomPlanner.isPlannedLocation(structure.pos, 'rampart'),
			) : [];
			const unwantedDefenses = [...unwantedWalls, ...unwantedRamparts];

			for (const structure of unwantedDefenses) {
				if (hivemind.settings.get('dismantleUnwantedRamparts')) {
					this.memory.dismantle[structure.id] = 1;
				}
				else if (structure.structureType === STRUCTURE_WALL) {
					structure.destroy();
				}
			}
		}
	}

	manageExtensions() {
		if (!this.canCreateConstructionSites()) return;

		// Make sure extensions are built in the right place, remove otherwise.
		this.removeUnplannedStructures('extension', STRUCTURE_EXTENSION, 1);
		if (this.room.controller.level >= 3) {
			// We can now build extensions near energy sources, since harvesters are now
			// big enough that one will be able to harvest all available energy.
			this.buildPlannedStructures('extension.harvester', STRUCTURE_EXTENSION, pos => this.roomPlanner.isPlannedLocation(pos, 'extension'));
		}

		// Otherwise, build extensions one bay at a time.
		for (let i = 0; i < 10; i++) {
			this.buildPlannedStructures(`extension.bay.${i}`, STRUCTURE_EXTENSION, pos => this.roomPlanner.isPlannedLocation(pos, 'extension'));
		}

		// Then, all extensions we might have missed.
		this.buildPlannedStructures('extension.bay', STRUCTURE_EXTENSION, pos => this.roomPlanner.isPlannedLocation(pos, 'extension'));
		this.buildPlannedStructures('extension', STRUCTURE_EXTENSION);
	}

	manageLinks() {
		const limit = CONTROLLER_STRUCTURES[STRUCTURE_LINK][this.room.controller.level];
		let count = 0;
		// Make sure links are built in the right place, remove otherwise.
		this.removeUnplannedStructures('link', STRUCTURE_LINK, 1);
		if (!this.buildPlannedStructures('link.controller', STRUCTURE_LINK)) return;
		if (++count >= limit) return;

		// Build link to farthest locations first.
		const farthestLinks = _.sortBy(this.roomPlanner.getLocations('link.source'), p => -p.getRangeTo(this.room.controller.pos));
		for (const pos of farthestLinks) {
			if (!this.tryBuild(pos, STRUCTURE_LINK)) return;
			if (++count >= limit) return;
		}

		this.buildPlannedStructures('link.source', STRUCTURE_LINK);
		this.buildPlannedStructures('link.storage', STRUCTURE_LINK);
		if (++count >= limit) return;
		this.buildPlannedStructures('link', STRUCTURE_LINK);
	}

	manageExtractors() {
		const plannedLocations = this.roomPlanner.getLocations('extractor');
		if (plannedLocations.length <= CONTROLLER_STRUCTURES[STRUCTURE_EXTRACTOR][this.room.controller.level]) {
			this.buildPlannedStructures('extractor', STRUCTURE_EXTRACTOR);
			return;
		}

		const sortedMinerals = _.sortBy(this.scoreExtractorPositions(plannedLocations), p => -p.score);

		let missingExtractors = 0;
		let missingThoriumExtractor = false;
		for (const mineral of sortedMinerals) {
			// Build extractor only on minerals that have resources left.
			if (mineral.score > 0) {
				if (mineral.hasExtractor) {
					const extractor = _.find(mineral.position.lookFor(LOOK_STRUCTURES), s => s.structureType === STRUCTURE_EXTRACTOR);
					if (!extractor) continue;
					if (missingThoriumExtractor && extractor.destroy() === OK) {
						missingExtractors--;
						missingThoriumExtractor = false;
						this.memory.runNextTick = true;
					}
				}
				else {
					const currentExtractors = _.size(this.structuresByType[STRUCTURE_EXTRACTOR]) + _.size(this.constructionSitesByType[STRUCTURE_EXTRACTOR]);

					if (currentExtractors >= CONTROLLER_STRUCTURES[STRUCTURE_EXTRACTOR][this.room.controller.level]) {
						missingExtractors++;
						// If (mineral.mineralType === RESOURCE_THORIUM) missingThoriumExtractor = true;
					}
					else {
						this.tryBuild(mineral.position, STRUCTURE_EXTRACTOR);
					}
				}

				continue;
			}

			// Dismantle extractors if its mineral is empty and there's an uncovered
			// mineral with resources left.
			if (missingExtractors === 0) break;
			if (!mineral.hasExtractor) continue;

			const extractor = _.find(mineral.position.lookFor(LOOK_STRUCTURES), s => s.structureType === STRUCTURE_EXTRACTOR);
			if (!extractor) continue;

			if (extractor.destroy() === OK) {
				missingExtractors--;
				this.memory.runNextTick = true;
			}
		}
	}

	scoreExtractorPositions(positions: RoomPosition[]): ScoredExtractorPosition[] {
		const result: ScoredExtractorPosition[] = [];

		for (const position of positions) {
			const mineral = position.lookFor(LOOK_MINERALS)[0];

			const structures = position.lookFor(LOOK_STRUCTURES);
			const constructionSites = position.lookFor(LOOK_CONSTRUCTION_SITES);

			const hasExtractor = _.some(structures, s => s.structureType === STRUCTURE_EXTRACTOR)
				|| _.some(constructionSites, s => s.structureType === STRUCTURE_EXTRACTOR);

			let scoreFactor = 1; // Mineral && mineral.mineralType === RESOURCE_THORIUM ? 5 : 1;
			if (mineral && !mineral.room.isStripmine() && mineral.mineralAmount < 500) {
				scoreFactor = 0;
			}

			result.push({
				position,
				hasExtractor,
				score: (mineral?.mineralAmount || -100) * scoreFactor,
				mineralType: mineral?.mineralType,
			});
		}

		return result;
	}

	/**
	 * Try placing construction sites of the given type at all locations.
	 *
	 * @param {string} locationType
	 *   The type of location that should be checked.
	 * @param {string} structureType
	 *   The type of structure to place.
	 * @param {Function} filterCallback
	 *   If a callback is provided, structures are only constructed for positions
	 *   where it returns true.
	 *
	 * @return {boolean}
	 *   True if we can continue building.
	 */
	buildPlannedStructures(locationType: string, structureType: StructureConstant, filterCallback?: (pos: RoomPosition) => boolean): boolean {
		let canBuildMore = true;
		for (const pos of this.roomPlanner.getLocations(locationType)) {
			if (filterCallback && !filterCallback(pos)) continue;
			if (this.tryBuild(pos, structureType)) continue;

			canBuildMore = false;
			break;
		}

		return canBuildMore;
	}

	buildOperationRoads() {
		const positions = this.getOperationRoadPositions();
		for (const pos of _.values<RoomPosition>(positions)) {
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
	tryBuild(pos: RoomPosition, structureType) {
		// Check if there's a structure here already.
		const structures = pos.lookFor(LOOK_STRUCTURES);
		for (const structure of structures) {
			if (structure.structureType === structureType) {
				// Structure is here, continue.
				return true;
			}
		}

		// Check if there's a construction site here already.
		const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
		for (const site of sites) {
			if (site.structureType === structureType) {
				// Structure is being built, continue.
				return true;
			}
		}

		const canCreateMoreSites = this.newStructures + this.roomConstructionSites.length < 5;
		if (canCreateMoreSites && _.size(Game.constructionSites) < MAX_CONSTRUCTION_SITES * 0.9) {
			// Don't try to build some structures if a nuke is about to land nearby.
			if ([STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_LINK, STRUCTURE_CONTAINER, STRUCTURE_ROAD].includes(structureType) && pos.findInRange(FIND_NUKES, 2).length > 0) {
				return true;
			}

			const isBlocked = OBSTACLE_OBJECT_TYPES.includes(structureType)
				&& (pos.lookFor(LOOK_CREEPS).length > 0 || pos.lookFor(LOOK_POWER_CREEPS).length > 0);
			if (!isBlocked && pos.createConstructionSite(structureType) === OK) {
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
	 */
	removeMisplacedSpawn(roomSpawns: StructureSpawn[]) {
		this.memory.hasMisplacedSpawn = false;

		for (const spawn of roomSpawns) {
			if (this.roomPlanner.isPlannedLocation(spawn.pos, 'spawn')) continue;

			this.memory.hasMisplacedSpawn = true;

			// Only destroy spawn if there are enough resources and builders available.
			const roomEnergy = this.room.storage ? this.room.storage.store.energy : 0;
			const resourcesAvailable = (roomEnergy > CONSTRUCTION_COST[STRUCTURE_SPAWN] * 2 && _.size(this.room.creepsByRole.builder) > 1);
			if (!resourcesAvailable && _.size(roomSpawns) === 1) return;

			// This spawn is misplaced, set a flag for spawning more builders to help.
			if (roomEnergy > CONSTRUCTION_COST[STRUCTURE_SPAWN] * 2) {
				this.memory.isMovingMisplacedSpawn = true;
			}

			// Don't check whether spawn can be moved right now if a creep is spawning.
			if (spawn.spawning) continue;

			let buildPower = 0;
			for (const creep of _.values<Creep>(this.room.creepsByRole.builder)) {
				if (creep.ticksToLive) {
					buildPower += creep.getActiveBodyparts(WORK) * creep.ticksToLive / CREEP_LIFE_TIME;
				}
			}

			if (buildPower > 15) {
				spawn.destroy();
				this.memory.runNextTick = true;
				// Only kill of one spawn at a time, it should be rebuilt right away next tick!
				return;
			}
		}
	}

	/**
	 * Checks if the room has a spawn at the wrong location.
	 *
	 * @return {boolean}
	 *   True if a spawn needs to be moved.
	 */
	isMovingMisplacedSpawn(): boolean {
		return this.memory.isMovingMisplacedSpawn;
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
	removeUnplannedStructures(locationType: string, structureType: BuildableStructureConstant, amount?: number) {
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

		for (const site of sites) {
			if (!this.roomPlanner.isPlannedLocation(site.pos, locationType)) {
				site.remove();
			}
		}
	}

	/**
	 * Checks if all ramparts in the room have at least 500.000 hits.
	 *
	 * @return {boolean}
	 *   True if walls are considered complete.
	 */
	checkWallIntegrity(minHits?: number) {
		// @todo make this consistent with defense manager.
		if (!minHits) minHits = hivemind.settings.get('minWallIntegrity');

		const maxHealth = hivemind.settings.get('maxWallHealth');
		const targetHealth = minHits * maxHealth[this.room.controller.level] / maxHealth[8];

		return cache.inHeap(`wallIntegrity:${this.room.name}:${minHits}`, 100, () => {
			for (const pos of this.roomPlanner.getLocations('rampart')) {
				if (this.roomPlanner.isPlannedLocation(pos, 'rampart.ramp')) continue;

				// Check if there's a rampart here already.
				const structures = pos.lookFor(LOOK_STRUCTURES);
				if (_.filter(structures, structure => structure.structureType === STRUCTURE_RAMPART && structure.hits >= targetHealth).length === 0) {
					return false;
				}
			}

			return true;
		});
	}

	/**
	 * Builds structures that are relevant in fully built rooms only.
	 */
	buildEndgameStructures() {
		if (this.room.terminal) {
			// Once there is a terminal, build quad-breaker walls.
			this.buildPlannedStructures('wall.quad', STRUCTURE_WALL);
		}

		if (!this.canCreateConstructionSites()) return;

		this.buildLabs();
		if (!this.canCreateConstructionSites()) return;

		this.buildNukers();
		if (!this.canCreateConstructionSites()) return;

		this.buildPowerSpawns();
		if (!this.canCreateConstructionSites()) return;

		this.buildObservers();
		if (!this.canCreateConstructionSites()) return;

		this.buildFactories();
	}

	buildLabs() {
		if (!hivemind.settings.get('constructLabs')) return;

		// Make sure labs are built in the right place, remove otherwise.
		this.removeUnplannedStructures('lab', STRUCTURE_LAB, 1);
		if (CONTROLLER_STRUCTURES[STRUCTURE_LAB][this.room.controller.level] === 3) {
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

	buildNukers() {
		if (!hivemind.settings.get('constructNukers')) return;

		// Make sure all current nukers have been built.
		if (_.size(this.roomConstructionSites) === 0) this.removeUnplannedStructures('nuker', STRUCTURE_NUKER, 1);
		this.buildPlannedStructures('nuker', STRUCTURE_NUKER);
	}

	buildPowerSpawns() {
		if (!hivemind.settings.get('constructPowerSpawns')) return;

		// Make sure all current power spawns have been built.
		if (_.size(this.roomConstructionSites) === 0) this.removeUnplannedStructures('powerSpawn', STRUCTURE_POWER_SPAWN, 1);
		this.buildPlannedStructures('powerSpawn', STRUCTURE_POWER_SPAWN);
	}

	buildObservers() {
		if (!hivemind.settings.get('constructObservers')) return;

		// Make sure all current observers have been built.
		if (_.size(this.roomConstructionSites) === 0) this.removeUnplannedStructures('observer', STRUCTURE_OBSERVER, 1);
		this.buildPlannedStructures('observer', STRUCTURE_OBSERVER);
	}

	buildFactories() {
		if (!hivemind.settings.get('constructFactories')) return;

		// Make sure all current factories have been built.
		if (_.size(this.roomConstructionSites) === 0) {
			this.removeUnplannedStructures('factory', STRUCTURE_FACTORY, 1);
			if (
				this.room.factory && (this.room.factory.level || 0) > 0
				&& this.room.factoryManager && this.room.factoryManager.getFactoryLevel() > 0
				&& this.room.factory.level !== this.room.factoryManager.getFactoryLevel()
			) {
				this.room.factory.destroy();
			}
		}

		this.buildPlannedStructures('factory', STRUCTURE_FACTORY);
	}

	/**
	 * Decides whether a dismantler is needed in the current room.
	 */
	needsDismantling(): boolean {
		return _.size(this.memory.dismantle) > 0;
	}

	/**
	 * Decides on a structure that needs to be dismantled.
	 */
	getDismantleTarget(): Structure {
		if (!this.needsDismantling()) return null;

		for (const id of _.keys(this.memory.dismantle)) {
			const structure = Game.getObjectById(id as Id<AnyOwnedStructure>);
			if (!structure) {
				delete this.memory.dismantle[id];
				continue;
			}

			// If there's a rampart on it, dismantle the rampart first if requested, or just destroy the building immediately.
			const structures = structure.pos.lookFor(LOOK_STRUCTURES);
			let innocentRampartFound = false;
			for (const structure of structures) {
				if (structure.structureType === STRUCTURE_RAMPART) {
					if (this.memory.dismantle[structure.id]) {
						return structure;
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
}

/**
 * Decides whether a structure is supposed to be dismantled.
 */
Structure.prototype.needsDismantling = function (this: Structure): boolean {
	if (!this.room.roomManager || !this.room.roomManager.needsDismantling()) return false;

	if (this.room.roomManager.memory.dismantle?.[this.id]) {
		return true;
	}

	return false;
};
