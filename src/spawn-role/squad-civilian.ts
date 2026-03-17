/* global CARRY WORK MAX_CREEP_SIZE CREEP_SPAWN_TIME CREEP_LIFE_TIME */

import BodyBuilder from 'creep/body-builder';
import NavMesh from 'utils/nav-mesh';
import container from 'utils/container';
import SpawnRole from 'spawn-role/spawn-role';
import SquadManager, {Squad} from 'manager.squad';

interface SquadCivilianSpawnOption extends SpawnOption {
	unitType: 'builder';
	squad: string;
	civilianSpecialization?: CivilianSpecialization;
}

export default class SquadCivilianSpawnRole extends SpawnRole {
	squadManager: SquadManager;

	constructor() {
		super();
		this.squadManager = container.get('SquadManager');
	}

	/**
	 * Adds civilian squad spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room) {
		return this.cacheEmptySpawnOptionsFor(room, 10, () => {
			const options: SquadCivilianSpawnOption[] = [];

			_.each(this.squadManager.getAllSquads(), (squad: Squad) => {
				if (squad.isExternallyManaged()) return;
				if (squad.getSpawn() !== room.name) return;

				const availableEnergy = room.getEffectiveAvailableEnergy();
				if (availableEnergy < 5000) return;

				if (!this.needsSpawning(room, squad)) return;

				const civilianSpecialization = this.getCivilianSpecializationToSpawn(squad, room);

				const roomHasReserves = availableEnergy > 10_000;
				options.push({
					priority: roomHasReserves ? 4 : 2,
					weight: 1.1,
					unitType: 'builder',
					squad: squad.getName(),
					civilianSpecialization,
				});
			});

			return options;
		});
	}

	/**
	 * Estimates the travel time in ticks from the given spawn room to the
	 * squad's target position. Falls back to 200 ticks when the path cannot
	 * be determined. NavMesh.estimateTravelTime already caches results in heap
	 * for 1000 ticks, so this is cheap to call repeatedly.
	 */
	getTravelTimeForSquad(squad: Squad, spawnRoom: Room): number {
		const target = squad.getTarget();
		if (!target) return 200;
		if (!spawnRoom.roomPlanner) return 200;

		const spawnPos = spawnRoom.roomPlanner.getRoomCenter();
		if (!spawnPos) return 200;

		const navMesh = new NavMesh();
		return navMesh.estimateTravelTime(spawnPos, target) ?? 200;
	}

	/**
	 * Returns 'builder' creeps belonging to a squad that still have enough
	 * TTL to be counted as alive for spawning purposes. Creeps that are still
	 * spawning always count. The minimum TTL threshold is:
	 *   travelTime + max spawn time + 100 tick safety margin.
	 */
	getActiveBuilderCreeps(squad: Squad, spawnRoom: Room): Creep[] {
		const creepsOfType = Game.creepsBySquad[squad.getName()]?.builder ?? {};
		const travelTime = this.getTravelTimeForSquad(squad, spawnRoom);
		const minTtl = travelTime + (MAX_CREEP_SIZE * CREEP_SPAWN_TIME) + 100;

		return Object.values(creepsOfType).filter(creep => {
			if (creep.spawning) return true;
			return (creep.ticksToLive ?? CREEP_LIFE_TIME) > minTtl;
		});
	}

	/**
	 * Decides whether a squad needs additional civilian builder units spawned.
	 *
	 * @param {Room} room
	 *   The spawn room.
	 * @param {Squad} squad
	 *   The squad to check.
	 *
	 * @return {boolean}
	 *   True if the squad needs more builder units.
	 */
	needsSpawning(room: Room, squad: Squad): boolean {
		if (!squad.getComposition().builder) return false;

		const activeCount = this.getActiveBuilderCreeps(squad, room).length;
		return squad.getUnitCount('builder') > activeCount;
	}

	/**
	 * Gets the body of a creep to be spawned.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object} option
	 *   The spawn option for which to generate the body.
	 *
	 * @return {string[]}
	 *   A list of body parts the new creep should consist of.
	 */
	getCreepBody(room: Room, option: SquadCivilianSpawnOption): BodyPartConstant[] {
		const energyLimit = Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable));

		if (option.civilianSpecialization === 'harvester') {
			return (new BodyBuilder())
				.setWeights({[WORK]: 4, [CARRY]: 1})
				.setPartLimit(WORK, 10)
				.setCarryContentLevel(0)
				.setEnergyLimit(energyLimit)
				.build();
		}

		if (option.civilianSpecialization === 'transporter') {
			return (new BodyBuilder())
				.setWeights({[CARRY]: 1})
				.setPartLimit(CARRY, 10)
				.setEnergyLimit(energyLimit)
				.build();
		}

		if (option.civilianSpecialization === 'builder') {
			return (new BodyBuilder())
				.setWeights({[CARRY]: 4, [WORK]: 1})
				.setPartLimit(WORK, 5)
				.setCarryContentLevel(0.3)
				.setEnergyLimit(energyLimit)
				.build();
		}

		if (option.civilianSpecialization === 'remoteHarvester') {
			// Plains movement: will travel to unroaded neighboring rooms.
			// Work limit matches the 6-WORK saturation threshold.
			return (new BodyBuilder())
				.setWeights({[WORK]: 4, [CARRY]: 1})
				.setPartLimit(WORK, 6)
				.setCarryContentLevel(0)
				.setEnergyLimit(energyLimit)
				.build();
		}

		if (option.civilianSpecialization === 'relayHauler') {
			// Plains movement: path to the source and back has no roads yet.
			return (new BodyBuilder())
				.setWeights({[CARRY]: 1})
				.setPartLimit(CARRY, 10)
				.setEnergyLimit(energyLimit)
				.build();
		}

		// Legacy: no specialization set - use original generalist body.
		return (new BodyBuilder())
			.setWeights({[CARRY]: 3, [WORK]: 2})
			.setEnergyLimit(energyLimit)
			.build();
	}

	/**
	 * Determines which civilian specialization still needs to be spawned for
	 * a given squad, based on the squad's civilianCounts and live creep
	 * specializations. Only builder creeps with sufficient TTL are counted,
	 * so pre-spawning happens before existing specialists expire.
	 *
	 * @param {Squad} squad
	 *   The squad to check.
	 * @param {Room} spawnRoom
	 *   The room the squad spawns from, used to estimate travel time.
	 *
	 * @return {CivilianSpecialization | null}
	 *   The next needed specialization, or null if all slots are filled.
	 */
	getCivilianSpecializationToSpawn(squad: Squad, spawnRoom: Room): CivilianSpecialization | null {
		const spawnedCounts: Partial<Record<CivilianSpecialization, number>> = {};
		const activeBuilderCreeps = this.getActiveBuilderCreeps(squad, spawnRoom);
		for (const creep of activeBuilderCreeps) {
			const spec = creep.memory.squadCivilianSpecialization;
			if (spec) spawnedCounts[spec] = (spawnedCounts[spec] ?? 0) + 1;
		}

		for (const type of ['harvester', 'transporter', 'builder', 'remoteHarvester', 'relayHauler'] as CivilianSpecialization[]) {
			if ((squad.getCivilianCount(type) ?? 0) > (spawnedCounts[type] ?? 0)) {
				return type;
			}
		}

		return null;
	}

	/**
	 * Gets memory for a new civilian squad creep.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object} option
	 *   The spawn option for which to generate the body.
	 *
	 * @return {Object}
	 *   The newly spawned creep's initial memory.
	 */
	getCreepMemory(room: Room, option: SquadCivilianSpawnOption): CreepMemory {
		return {
			role: 'squad-civilian',
			squadName: option.squad,
			squadUnitType: 'builder',
			...(option.civilianSpecialization ? {squadCivilianSpecialization: option.civilianSpecialization} : {}),
		};
	}
}
