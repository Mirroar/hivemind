/* global MOVE ATTACK WORK CARRY HEAL */


import SpawnRole from 'spawn-role/spawn-role';

declare global {
	interface RoomDefenseSpawnOption extends SpawnOption {
		responseType?: number;
		creepRole: string;
	}
}

const RESPONSE_NONE = 0;
const RESPONSE_ATTACKER = 1;
const RESPONSE_RANGED_ATTACKER = 2;

export default class RoomDefenseSpawnRole extends SpawnRole {
	/**
	 * Adds defense spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room) {
		const options: RoomDefenseSpawnOption[] = [];
		this.addLowLevelRoomSpawnOptions(room, options);
		this.addRampartDefenderSpawnOptions(room, options);
		this.addEmergencyRepairSpawnOptions(room, options);

		return options;
	}

	/**
	 * Adds brawler spawn options for low level rooms.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	addLowLevelRoomSpawnOptions(room: Room, options: RoomDefenseSpawnOption[]) {
		// In low level rooms, add defenses!
		if (room.controller.level >= 4) return;
		if (!room.memory.enemies || room.memory.enemies.safe) return;
		if (_.size(room.creepsByRole.brawler) >= 2) return;

		options.push({
			priority: 5,
			weight: 1,
			creepRole: 'brawler',
		});
	}

	/**
	 * Adds guardian spawn options for rampart defense.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	addRampartDefenderSpawnOptions(room: Room, options: RoomDefenseSpawnOption[]) {
		if (room.controller.level < 4) return;
		if (!room.memory.enemies || room.memory.enemies.safe) return;

		const responseType = this.getDefenseCreepSize(room);

		if (responseType === RESPONSE_NONE) return;

		// @todo Limit defense creeps to number of threats and ramparts to cover.
		if (_.size(room.creepsByRole.guardian) >= 5) return;

		options.push({
			priority: 5,
			weight: 1,
			responseType,
			creepRole: 'guardian',
		});
	}

	/**
	 * Spawn extra builders to keep ramparts up when attacked.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	addEmergencyRepairSpawnOptions(room: Room, options: RoomDefenseSpawnOption[]) {
		if (room.controller.level < 4) return;
		if (!room.memory.enemies || room.memory.enemies.safe) return;
		if (room.getStoredEnergy() < 10_000) return;

		// @todo Send energy to rooms under attack for assistance.

		const responseType = this.getDefenseCreepSize(room);

		if (responseType === RESPONSE_NONE) return;

		if (_.size(room.creepsByRole.builder) >= 5) return;

		options.push({
			priority: 4,
			weight: 1,
			responseType,
			creepRole: 'builder',
		});
	}

	getDefenseCreepSize(room: Room): number {
		const enemyStrength = room.defense.getEnemyStrength();

		if (enemyStrength >= 2) {
			// Spawn a mix of meelee and ranged defenders.
			const totalGuardians = _.size(room.creepsByRole.guardian);
			const rangedGuardians = _.size(_.filter(room.creepsByRole.guardian, (creep: GuardianCreep) => creep.getActiveBodyparts(RANGED_ATTACK) > 0));

			if (rangedGuardians < totalGuardians / 2) return RESPONSE_RANGED_ATTACKER;

			return RESPONSE_ATTACKER;
		}

		// @todo Decide if boosts should be used as well.

		// If attacker too weak, don't spawn defense at all. Towers will handle it.
		return RESPONSE_NONE;
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
	getCreepBody(room: Room, option: RoomDefenseSpawnOption): BodyPartConstant[] {
		if (option.creepRole === 'builder') return this.getRepairCreepBody(room);

		if (option.responseType) {
			switch (option.responseType) {
				case RESPONSE_RANGED_ATTACKER:
					return this.getRangedCreepBody(room);

				case RESPONSE_ATTACKER:
				default:
					return this.getAttackCreepBody(room);
			}
		}

		return this.getAttackCreepBody(room);
	}

	getAttackCreepBody(room: Room): BodyPartConstant[] {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.35, [ATTACK]: 0.65},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
		);
	}

	getRangedCreepBody(room: Room): BodyPartConstant[] {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.35, [RANGED_ATTACK]: 0.65},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
		);
	}

	getRepairCreepBody(room: Room): BodyPartConstant[] {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.35, [WORK]: 0.35, [CARRY]: 0.3},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
		);
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
	getCreepMemory(room: Room, option: RoomDefenseSpawnOption): CreepMemory {
		const memory = {
			singleRoom: room.name,
			role: option.creepRole,
		};

		return memory;
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
	getCreepBoosts(room: Room, option: RoomDefenseSpawnOption, body: BodyPartConstant[]): Record<string, ResourceConstant> {
		// @todo Only use boosts if they'd make the difference between being able to damage the enemy or not.
		if (option.creepRole === 'builder') {
			return this.generateCreepBoosts(room, body, WORK, 'repair');
		}
		else if (option.creepRole === 'guardian') {
			if (body.includes(ATTACK)) {
				return this.generateCreepBoosts(room, body, ATTACK, 'attack');
			}
			else {
				return this.generateCreepBoosts(room, body, RANGED_ATTACK, 'rangedAttack');
			}
		}

		return null;
	}

	/**
	 * Act when a creep belonging to this spawn role is successfully spawning.
	 *
	 * @param {Room} room
	 *   The room the creep is spawned in.
	 * @param {Object} option
	 *   The spawn option which caused the spawning.
	 * @param {string[]} body
	 *   The body generated for this creep.
	 * @param {string} name
	 *   The name of the new creep.
	 */
	onSpawn(room: Room, option: RoomDefenseSpawnOption, body: BodyPartConstant[], name: string) {
		if (option.creepRole === 'guardian') {
			hivemind.log('creeps', room.name).info('Spawning new guardian', name, 'to defend', room.name);
		}
	}
}
