/* global MOVE ATTACK RANGED_ATTACK HEAL TOUGH CLAIM MAX_CREEP_SIZE CREEP_SPAWN_TIME CREEP_LIFE_TIME */

import BodyBuilder, {MOVEMENT_MODE_SWAMP} from 'creep/body-builder';
import NavMesh from 'utils/nav-mesh';
import container from 'utils/container';
import SpawnRole from 'spawn-role/spawn-role';
import SquadManager, {Squad} from 'manager.squad';

const allUnitTypes = [
	'ranger',
	'healer',
	'claimer',
	'singleClaim',
	'builder',
	'attacker',
	'brawler',
	'blinky',
	'test',
	'boostedBlinky',
] as const;

declare global {
	type SquadUnitType = typeof allUnitTypes[number];
}

/**
 * Military unit types handled by this spawn role. Civilian types like
 * 'builder' are handled by the squad-civilian spawn role.
 */
const militaryUnitTypes: readonly SquadUnitType[] = [
	'ranger',
	'healer',
	'claimer',
	'singleClaim',
	'attacker',
	'brawler',
	'blinky',
	'test',
	'boostedBlinky',
];

interface SquadSpawnOption extends SpawnOption {
	unitType: SquadUnitType;
	squad: string;
}

export default class SquadSpawnRole extends SpawnRole {
	squadManager: SquadManager;

	constructor() {
		super();
		this.squadManager = container.get('SquadManager');
	}

	/**
	 * Adds squad spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room) {
		return this.cacheEmptySpawnOptionsFor(room, 10, () => {
			const options: SquadSpawnOption[] = [];

			_.each(this.squadManager.getAllSquads(), (squad: Squad) => {
				if (squad.getSpawn() !== room.name) return;

				const availableEnergy = room.getEffectiveAvailableEnergy();
				if (availableEnergy < 5000) return;

				const spawnUnitType = this.needsSpawning(room, squad);
				if (!spawnUnitType) return;

				const roomHasReserves = availableEnergy > 10_000;
				options.push({
					priority: roomHasReserves ? 4 : 2,
					weight: 1.1,
					unitType: spawnUnitType,
					squad: squad.getName(),
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
	 * Returns creeps of the given unit type belonging to a squad that still have
	 * enough TTL to be counted as alive for spawning purposes. Creeps that are
	 * still spawning always count. The minimum TTL threshold is:
	 *   travelTime + max spawn time + 100 tick safety margin.
	 */
	getActiveSquadCreeps(squad: Squad, unitType: SquadUnitType, spawnRoom: Room): Creep[] {
		const creepsOfType = Game.creepsBySquad[squad.getName()]?.[unitType] ?? {};
		const travelTime = this.getTravelTimeForSquad(squad, spawnRoom);
		const minTtl = travelTime + (MAX_CREEP_SIZE * CREEP_SPAWN_TIME) + 100;

		return Object.values(creepsOfType).filter(creep => {
			if (creep.spawning) return true;
			return (creep.ticksToLive ?? CREEP_LIFE_TIME) > minTtl;
		});
	}

	/**
	 * Decides whether a squad needs additional units spawned.
	 *
	 * @param {Squad} squad
	 *   The squad to check.
	 *
	 * @return {string|null}
	 *   Type of the unit that needs spawning.
	 */
	needsSpawning(room: Room, squad: Squad): SquadUnitType | null {
		const neededUnits: SquadUnitType[] = [];
		for (const unitType in squad.getComposition()) {
			if (!militaryUnitTypes.includes(unitType as SquadUnitType)) continue;

			const activeCount = this.getActiveSquadCreeps(squad, unitType as SquadUnitType, room).length;
			if (squad.getUnitCount(unitType as SquadUnitType) > activeCount) {
				neededUnits.push(unitType as SquadUnitType);
			}
		}

		// @todo Some squad units might need to be spawned at higher priorities
		// than others.
		return _.sample(neededUnits);
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
	getCreepBody(room: Room, option: SquadSpawnOption): BodyPartConstant[] {
		// Automatically call spawning function for selected unit type.
		const methodName = 'get' + _.capitalize(option.unitType) + 'CreepBody';
		const bodyCallback: (room: Room, option: SquadSpawnOption) => BodyPartConstant[] = this[methodName];
		if (bodyCallback) return bodyCallback.call(this, room, option);

		// If the unit type is not supported, spawn a general brawler.
		return this.getBrawlerCreepBody(room);
	}

	getRangerCreepBody(room: Room) {
		return (new BodyBuilder())
			.setWeights({[RANGED_ATTACK]: 3})
			.setMoveBufferRatio(0.4)
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
			.build();
	}

	getHealerCreepBody(room: Room) {
		return (new BodyBuilder())
			.setWeights({[HEAL]: 1})
			.setMoveBufferRatio(0.4)
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
			.build();
	}

	getClaimerCreepBody(room: Room) {
		return (new BodyBuilder())
			.setWeights({[CLAIM]: 3, [TOUGH]: 2})
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
			.build();
	}

	getSingleClaimCreepBody(room: Room) {
		return (new BodyBuilder())
			.setWeights({[CLAIM]: 1})
			.setPartLimit(CLAIM, 1)
			.setMovementMode(MOVEMENT_MODE_SWAMP)
			.setEnergyLimit(room.energyCapacityAvailable)
			.build();
	}

	getAttackerCreepBody(room: Room) {
		return (new BodyBuilder())
			.setWeights({[ATTACK]: 1})
			.setMoveBufferRatio(0.4)
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
			.build();
	}

	getTestCreepBody() {
		return [MOVE];
	}

	getBlinkyCreepBody(room: Room) {
		return (new BodyBuilder())
			.setWeights({[RANGED_ATTACK]: 3, [HEAL]: 2})
			.setMoveBufferRatio(0.4)
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
			.build();
	}

	getBrawlerCreepBody(room: Room) {
		return (new BodyBuilder())
			.setWeights({[ATTACK]: 3, [HEAL]: 2})
			.setMoveBufferRatio(0.4)
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
			.build();
	}

	getBoostedBlinkyCreepBody(room: Room) {
		return (new BodyBuilder())
			.setWeights({[TOUGH]: 1, [RANGED_ATTACK]: 3, [HEAL]: 2})
			.setMoveBufferRatio(0.4)
			.setMovePartBoost(this.getBestBoost(room, 12, 'fatigue'))
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
			.build();
	}

	/**
	 * Gets memory for a new creep.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object} option
	 *   The spawn option for which to generate the body.
	 *
	 * @return {Object}
	 *   The boost compound to use keyed by body part type.
	 */
	getCreepMemory(room: Room, option: SquadSpawnOption): CreepMemory {
		return {
			role: 'brawler',
			squadName: option.squad,
			squadUnitType: option.unitType,
		};
	}

	/**
	 * Gets which boosts to use on a new creep.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object} option
	 *   The spawn option for which to generate the body.
	 * @param {string[]} body
	 *   The body generated for this creep.
	 *
	 * @return {Object}
	 *   The boost compound to use keyed by body part type.
	 */
	getCreepBoosts(room: Room, option: SquadSpawnOption, body: BodyPartConstant[]): Record<string, ResourceConstant> {
		if (option.unitType === 'healer') {
			return this.generateCreepBoosts(room, body, HEAL, 'heal');
		}

		if (option.unitType === 'attacker') {
			return this.generateCreepBoosts(room, body, ATTACK, 'attack');
		}

		if (option.unitType === 'boostedBlinky') {
			return {
				...this.generateCreepBoosts(room, body, RANGED_ATTACK, 'rangedAttack'),
				...this.generateCreepBoosts(room, body, HEAL, 'heal'),
				...this.generateCreepBoosts(room, body, TOUGH, 'damage'),
				...this.generateCreepBoosts(room, body, MOVE, 'fatigue'),
			};
		}

		return null;
	}
}
