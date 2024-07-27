/* global BODYPART_COST OK */

import cache from 'utils/cache';
import hivemind from 'hivemind';
import SpawnRole from 'spawn-role/spawn-role';
import utilities from 'utilities';
import {handleMapArea} from 'utils/map';

declare global {
	interface StructureSpawn {
		waiting: boolean;
		numSpawnOptions: number;
	}

	interface SpawnHeapMemory extends StructureHeapMemory {
		blocked?: number;
	}

	interface Memory {
		creepCounter: Record<string, number>;
	}

	interface SpawnOption {
		role?: string;
		priority: number;
		weight: number;
		preferClosestSpawn?: RoomPosition;
	}
}

const roleNameMap = {
	builder: 'B',
	'builder.remote': 'BR',
	'builder.mines': 'BM',
	claimer: 'C',
	dismantler: 'D',
	brawler: 'F',
	gatherer: 'G',
	guardian: 'FE',
	harvester: 'H',
	'harvester.deposit': 'HD',
	'harvester.remote': 'HR',
	'harvester.power': 'HP',
	mule: 'M',
	scout: 'S',
	transporter: 'T',
	'hauler.power': 'TP',
	'hauler.relay': 'TRR',
	hauler: 'TR',
	upgrader: 'U',
};

const allDirections = [TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT];

export default class SpawnManager {
	roles: Record<string, SpawnRole>;
	roomsWithIdleSpawns: Record<string, number>;

	/**
	 * Creates a new SpawnManager instance.
	 */
	constructor() {
		this.roles = {};
		this.roomsWithIdleSpawns = {};
	}

	/**
	 * Registers a role to be managed.
	 *
	 * @param {String} roleId
	 *   Identifier of the role, as stored in a creep's memory.
	 * @param {Role} role
	 *   The role to register.
	 */
	registerSpawnRole(roleId: string, role: SpawnRole) {
		this.roles[roleId] = role;
	}

	/**
	 * Collects spawn options from all spawn roles.
	 *
	 * @param {Room} room
	 *   The room to use as context for spawn roles.
	 *
	 * @return {object[]}
	 *   An array of possible spawn options for the current room.
	 */
	getAllSpawnOptions(room: Room): SpawnOption[] {
		if ((this.roomsWithIdleSpawns[room.name] || -100) > Game.time) return [];

		return cache.inObject(room, 'spawnQueue', 1, () => {
			const options: SpawnOption[] = [];

			_.each(this.roles, (role, roleId) => {
				const roleOptions = role.getSpawnOptions(room);

				_.each(roleOptions, option => {
					// Set default values for options.
					if (typeof option.role === 'undefined') option.role = roleId;

					options.push(option);
				});
			});

			// Don't check spawn options every tick when there's nothing to spawn at the moment.
			if (options.length === 0) this.roomsWithIdleSpawns[room.name] = Game.time + 10;

			return options;
		});
	}

	/**
	 * Manages spawning in a room.
	 *
	 * @param {Room} room
	 *   The room to manage spawning in.
	 * @param {StructureSpawn[]} spawns
	 *   The room's spawns.
	 */
	manageSpawns(room: Room, spawns: StructureSpawn[]) {
		this.makeWayForSpawns(room, spawns);

		const availableSpawns = this.filterAvailableSpawns(spawns);
		if (availableSpawns.length === 0) return;

		const options: SpawnOption[] = _.filter(
			this.getAllSpawnOptions(room),
			(option: SpawnOption) => {
				if (!option.preferClosestSpawn) return true;

				const closestSpawn = _.min(spawns, spawn => spawn.pos.getRangeTo(option.preferClosestSpawn));
				// Only spawn once preferred spawn is ready.

				if (closestSpawn.pos.getRangeTo(option.preferClosestSpawn) < 3 && !availableSpawns.includes(closestSpawn)) return false;

				return true;
			},
		);
		const option = utilities.getBestOption(options);
		if (!option) return;

		let spawn = _.sample(availableSpawns);
		if (option.preferClosestSpawn) {
			const closestSpawn = _.min(spawns, spawn => spawn.pos.getRangeTo(option.preferClosestSpawn));
			// Only spawn once preferred spawn is ready.

			if (closestSpawn.pos.getRangeTo(option.preferClosestSpawn) < 3) {
				if (!availableSpawns.includes(closestSpawn)) return;

				spawn = closestSpawn;
			}
		}

		if (!this.trySpawnCreep(room, spawn, option)) {
			_.each(availableSpawns, s => {
				s.waiting = true;

				const role = this.roles[option.role];
				const body = role.getCreepBody(room, option);

				const creepCost = _.sum(body, part => BODYPART_COST[part]);
				room.visual.text(room.energyAvailable + '/' + creepCost, spawn.pos.x + 0.05, spawn.pos.y + 0.05, {
					font: 0.5,
					color: 'black',
				});
				room.visual.text(room.energyAvailable + '/' + creepCost, spawn.pos.x, spawn.pos.y, {
					font: 0.5,
				});

				room.visual.text(option.role + '@' + option.priority.toPrecision(1), spawn.pos.x + 0.05, spawn.pos.y + 0.65, {
					font: 0.5,
					color: 'black',
				});
				room.visual.text(option.role + '@' + option.priority.toPrecision(1), spawn.pos.x, spawn.pos.y + 0.6, {
					font: 0.5,
				});
			});
		}

		_.each(spawns, spawn => {
			spawn.numSpawnOptions = _.size(options);
		});
	}

	/**
	 * Tries spawning the selected creep.
	 *
	 * @param {Room} room
	 *   The room to manage spawning in.
	 * @param {StructureSpawn} spawn
	 *   The spawn where the creep should be spawned.
	 * @param {Object} option
	 *   The spawn option for which to generate the creep.
	 *
	 * @return {boolean}
	 *   True if spawning was successful.
	 */
	trySpawnCreep(room: Room, spawn: StructureSpawn, option): boolean {
		const role = this.roles[option.role];
		const body = role.getCreepBody(room, option);

		if (!body || body.length === 0) return false;

		let cost = 0;
		for (const part of body) {
			cost += BODYPART_COST[part];
		}

		if (cost > room.energyAvailable) return false;

		//  Make sure a creep like this could be spawned.
		if (spawn.spawnCreep(body, 'dryRun', {dryRun: true}) !== OK) return false;

		// Prepare creep memory.
		const memory = role.getCreepMemory(room, option);
		if (!memory.role) {
			memory.role = option.role;
		}

		// Actually try to spawn this creep.
		// @todo Use extensions grouped by bay to make refilling easier.
		const creepName = this.generateCreepName(memory.role);
		const directions = spawn.getSpawnDirections();
		const energyStructures = room.getEnergyStructures();
		const result = spawn.spawnCreep(body, creepName, {
			memory,
			directions,
			energyStructures,
		});

		if (result !== OK) {
			hivemind.log('creeps', room.name).error('Trying to spawn creep', creepName, 'failed with error code', result);
			hivemind.log('creeps', room.name).error('Body cost:', _.sum(body, part => BODYPART_COST[part]), 'Energy Capacity', room.energyCapacityAvailable, 'Energy:', room.energyAvailable);
			return false;
		}

		// Spawning successful.
		Memory.creepCounter[memory.role]++;

		// Also notify room's boost manager if necessary.
		const boosts = role.getCreepBoosts(room, option, body);
		if (boosts && room.boostManager) {
			const boostResources = {};
			let found = false;
			for (const partType of body) {
				if (!boosts[partType]) continue;

				boostResources[boosts[partType]] = (boostResources[boosts[partType]] || 0) + 1;
				found = true;
			}

			if (found) room.boostManager.markForBoosting(creepName, boostResources);
		}

		// Notify the role that spawning was successful.
		role.onSpawn(room, option, body, creepName);
		return true;
	}

	/**
	 * Generates a name for a new creep.
	 *
	 * @param {String} roleId
	 *   Identifier of the role, as stored in a creep's memory.
	 *
	 * @return {String}
	 *   The generated name.
	 */
	generateCreepName(roleId: string): string {
		// Generate creep name.
		if (!Memory.creepCounter) {
			Memory.creepCounter = {};
		}

		if (!Memory.creepCounter[roleId] || Memory.creepCounter[roleId] >= 36 * 36) {
			Memory.creepCounter[roleId] = 0;
		}

		const roleName = roleNameMap[roleId] || roleId;
		const name = roleName + '_' + Memory.creepCounter[roleId].toString(36);
		if (!Game.creeps[name]) return name;

		// Name already exists, sometimes happens after server crash.
		// Generate another.
		Memory.creepCounter[roleId]++;
		return this.generateCreepName(roleId);
	}

	/**
	 * Filters a list of spawns to only those available for spawning.
	 *
	 * @param {StructureSpawn[]} spawns
	 *   The list of spawns to filter.
	 *
	 * @return {StructureSpawn[]}
	 *   An array containing all spawns where spawning is possible.
	 */
	filterAvailableSpawns(spawns: StructureSpawn[]): StructureSpawn[] {
		return _.filter(spawns, spawn => {
			if (spawn.spawning) return false;

			return true;
		});
	}

	makeWayForSpawns(room: Room, spawns: StructureSpawn[]) {
		const terrain = new Room.Terrain(room.name);
		for (const spawn of spawns) {
			if (!spawn.spawning || spawn.spawning.remainingTime > 0) {
				delete spawn.heapMemory.blocked;
				continue;
			}

			spawn.heapMemory.blocked = (spawn.heapMemory.blocked || 0) + 1;
			if (spawn.heapMemory.blocked >= 5) {
				spawn.spawning.setDirections(allDirections);
			}

			let allBlocked = true;
			const closeCreeps = spawn.pos.findInRange(FIND_CREEPS, 1);
			const spawnDirections = spawn.spawning.directions || allDirections;
			handleMapArea(spawn.pos.x, spawn.pos.y, (x, y) => {
				if (x === spawn.pos.x && y === spawn.pos.y) return;

				const position = new RoomPosition(x, y, spawn.room.name);
				const dir = spawn.pos.getDirectionTo(position);
				if (!spawnDirections.includes(dir)) return;
				if (_.some(closeCreeps, c => position.isEqualTo(c.pos))) return;

				// Direction might be blocked by something else, like terrain,
				// structures or power creeps.
				if (terrain.get(x, y) === TERRAIN_MASK_WALL) return;
				if (position.lookFor(LOOK_POWER_CREEPS).length > 0) return;
				if (_.some(position.lookFor(LOOK_STRUCTURES), s => (OBSTACLE_OBJECT_TYPES as string[]).includes(s.structureType))) return;

				allBlocked = false;
			});

			if (!allBlocked) continue;

			for (const creep of closeCreeps) {
				if (!creep.my) continue;

				creep.move(_.sample(allDirections));
			}
		}
	}
}
