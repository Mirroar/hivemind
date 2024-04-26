/* global BODYPART_COST MAX_CREEP_SIZE TOUGH ATTACK RANGED_ATTACK HEAL */

export default class SpawnRole {
	private roomTimeouts: Record<string, number> = {};

	/**
	 * Adds spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): SpawnOption[] {
		return [];
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
	getCreepBody(room: Room, option: SpawnOption): BodyPartConstant[] {
		return [];
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
	getCreepBoosts(room: Room, option: SpawnOption, body: string[]): Record<string, ResourceConstant> {
		return null;
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
	 *   The newly spawned creep's initial memory.
	 */
	getCreepMemory(room: Room, option?: SpawnOption): CreepMemory {
		return {};
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
	onSpawn(room: Room, option: SpawnOption, body: BodyPartConstant[], name: string) {}

	/**
	 * Calculates the best available boost for a body part to use.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {String[]} body
	 *   The body generated for this creep.
	 * @param {String} partType
	 *   The body part type to apply boosts to.
	 * @param {String} boostType
	 *   The type of boost to use.
	 *
	 * @return {Object}
	 *   The boost compound to use keyed by body part type.
	 */
	generateCreepBoosts(room: Room, body: BodyPartConstant[], partType: BodyPartConstant, boostType: string, maxTier?: number): Partial<Record<string, ResourceConstant>> {
		if (!room.boostManager.canSpawnBoostedCreeps()) return {};

		const numberAffectedParts = _.countBy(body)[partType] || 0;
		const bestBoost = this.getBestBoost(room, numberAffectedParts, boostType, maxTier);

		if (!bestBoost) return {};

		return {
			[partType]: bestBoost,
		};
	}

	getBestBoost(room: Room, count: number, boostType: string, maxTier?: number): ResourceConstant {
		let bestBoost: ResourceConstant;
		const availableBoosts = room.boostManager.getAvailableBoosts(boostType);
		let resourceType: ResourceConstant;
		for (resourceType in availableBoosts) {
			if (availableBoosts[resourceType].available < count) continue;
			if (maxTier && resourceType.length > maxTier) continue;

			if (!bestBoost || (boostType === 'damage' && availableBoosts[resourceType].effect < availableBoosts[bestBoost].effect)) {
				bestBoost = resourceType;
			}
			else if (availableBoosts[resourceType].effect > availableBoosts[bestBoost].effect) {
				bestBoost = resourceType;
			}
		}

		return bestBoost;
	}

	/**
	 * Calculates the cost of a creep body array.
	 *
	 * @param {String[]} body
	 *   A creep body.
	 *
	 * @return {number}
	 *   The energy cost of the provided body.
	 */
	calculateBodyCost(body: BodyPartConstant[]): number {
		return _.reduce(body, (sum, part) => sum + BODYPART_COST[part], 0);
	}

	cacheEmptySpawnOptionsFor<T extends SpawnOption>(room: Room, timeout: number, callback: () => T[]): T[] {
		if (this.shouldNotCheckForAWhile(room)) return [];

		const options = callback();
		this.stopCheckingIfNothingToSpawn(room, timeout, options);

		return options;
	}

	shouldNotCheckForAWhile(room: Room): boolean {
		if ((this.roomTimeouts[room.name] || -1000) > Game.time) return true;

		return false;
	}

	stopCheckingIfNothingToSpawn(room: Room, timeout: number, options: SpawnOption[]) {
		if (options.length > 0) return;

		this.roomTimeouts[room.name] = Game.time + timeout;
	}
}
