/* global MOVE ATTACK RANGED_ATTACK HEAL TOUGH CLAIM CARRY WORK */

import BodyBuilder, {MOVEMENT_MODE_SWAMP} from 'creep/body-builder';
import SpawnRole from 'spawn-role/spawn-role';
import Squad, {getAllSquads} from 'manager.squad';

const availableUnitTypes = [
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
	type SquadUnitType = typeof availableUnitTypes[number];
}

interface SquadSpawnOption extends SpawnOption {
	unitType: SquadUnitType;
	squad: string;
}

export default class SquadSpawnRole extends SpawnRole {
	/**
	 * Adds squad spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room) {
		return this.cacheEmptySpawnOptionsFor(room, 10, () => {
			const options: SquadSpawnOption[] = [];

			_.each(getAllSquads(), squad => {
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
					squad: squad.name,
				});
			});

			return options;
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
		for (const unitType in squad.memory.composition) {
			if (!availableUnitTypes.includes(unitType as SquadUnitType)) continue;

			if (squad.getUnitCount(unitType as SquadUnitType) > _.size(squad.units[unitType])) {
				neededUnits.push(unitType as SquadUnitType);
			}
		}

		if (_.size(neededUnits) === 0) squad.memory.fullySpawned = true;

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

	getBuilderCreepBody(room: Room) {
		return (new BodyBuilder())
			.setWeights({[CARRY]: 3, [WORK]: 2})
			.setEnergyLimit(Math.min(room.energyCapacityAvailable, Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable)))
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
			}
		}

		return null;
	}
}
