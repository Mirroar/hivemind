/* global STRUCTURE_RAMPART ATTACK RANGED_ATTACK HEAL CLAIM MOVE TOUGH CARRY
LOOK_STRUCTURES */

import cache from 'utils/cache';
import hivemind from 'hivemind';
import Operation from 'operation/operation';
import {getDangerMatrix} from 'utils/cost-matrix';
import {getResourcesIn} from 'utils/store';

declare global {
	interface RoomMemory {
		defense?: RoomDefenseMemory;
	}
}

interface RoomDefenseMemory {
	lastActivity?: number;
	creepStatus?: Record<string, {
		store: Partial<Record<ResourceConstant, number>>;
		isThief?: boolean;
	}>;
}

const ENEMY_STRENGTH_NONE = 0; // No enemies in the room.
const ENEMY_STRENGTH_WEAK = 1; // Enemies are very weak, towers can take them out.
const ENEMY_STRENGTH_NORMAL = 2; // Enemies are strong or numerous, but can probably be handled with unboosted active defense.
const ENEMY_STRENGTH_STRONG = 3; // Enemies are strong or numerous, but can probably be handled with boosted active defense.
const ENEMY_STRENGTH_DEADLY = 4; // Enemies are strong or numerous, and we need help from outside.

type EnemyStrength = typeof ENEMY_STRENGTH_NONE
	| typeof ENEMY_STRENGTH_WEAK
	| typeof ENEMY_STRENGTH_NORMAL
	| typeof ENEMY_STRENGTH_STRONG
	| typeof ENEMY_STRENGTH_DEADLY;

const partStrength = {
	[ATTACK]: ATTACK_POWER,
	[RANGED_ATTACK]: RANGED_ATTACK_POWER,
	[HEAL]: HEAL_POWER,
	[CLAIM]: ATTACK_POWER / 2,
	[WORK]: DISMANTLE_POWER,
};

const relevantBoostAttribute = {
	[ATTACK]: 'attack',
	[RANGED_ATTACK]: 'rangedAttack',
	[HEAL]: 'heal',
	[WORK]: 'dismantle',
};

// @todo Evacuate room when walls are breached, or when spawns are gone, ...
// @todo Destroy terminal and storage if not hope of recovery?

export {
	ENEMY_STRENGTH_NONE,
	ENEMY_STRENGTH_WEAK,
	ENEMY_STRENGTH_NORMAL,
	ENEMY_STRENGTH_STRONG,
	ENEMY_STRENGTH_DEADLY,
};

export default class RoomDefense {
	roomName: string;
	room: Room;
	memory: RoomDefenseMemory;

	constructor(roomName: string) {
		this.roomName = roomName;
		this.room = Game.rooms[roomName];

		if (!this.room.memory.defense) this.room.memory.defense = {};

		this.memory = this.room.memory.defense;
	}

	drawDebug() {
		const dangerMatrix = getDangerMatrix(this.roomName);
		const visual = this.room.visual;
		if (!visual || hivemind.settings.get('disableRoomVisuals')) return;

		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				if (dangerMatrix.get(x, y) === 1) {
					visual.rect(x - 0.4, y - 0.4, 0.8, 0.8, {
						fill: '#af6060',
						opacity: 0.3,
					});
				}

				if (dangerMatrix.get(x, y) === 2) {
					visual.rect(x - 0.3, y - 0.3, 0.6, 0.6, {
						fill: '#6060af',
						opacity: 0.3,
					});
				}
			}
		}
	}

	/**
	 * Checks if a room's walls are intact.
	 *
	 * @return {boolean}
	 *   True if all planned ramparts are built and strong enough.
	 */
	isWallIntact(): boolean {
		return this.room.roomPlanner ? this.getLowestWallStrength() > 0 : true;
	}

	getLowestWallStrength(): number {
		return cache.inObject(this.room, 'weakestWallStrength', 1, () => {
			if (!this.room.roomPlanner) return 0;

			const rampartPositions: RoomPosition[] = this.room.roomPlanner.getLocations('rampart');
			let minHits: number;

			for (const pos of rampartPositions) {
				if (this.room.roomPlanner.isPlannedLocation(pos, 'rampart.ramp')) continue;

				// Check if there's a rampart here already.
				const structures = pos.lookFor(LOOK_STRUCTURES);
				const ramps = _.filter(structures, structure => structure.structureType === STRUCTURE_RAMPART);
				if (ramps.length === 0) {
					return 0;
				}

				if (!minHits || ramps[0].hits < minHits) {
					minHits = ramps[0].hits;
				}
			}

			return minHits;
		});
	}

	/**
	 * Determines enemy strength in a room.
	 *
	 * @return {Number}
	 *   0: No enemies in the room.
	 *   1: Enemies are very weak, towers can take them out.
	 *   2: Enemies are strong or numerous, but can probably be handled with
	 * 		unboosted active defense.
	 *   3: Enemies are strong or numerous, but can probably be handled with
	 * 		boosted active defense.
	 *   4: Enemies are strong or numerous, and we need help from outside.
	 */
	getEnemyStrength(): EnemyStrength {
		return cache.inObject(this.room, 'getEnemyStrength', 1, () => {
			let attackStrength = 0;
			let healStrength = 0;
			let totalStrength = 0;
			let invaderOnly = true;

			for (const userName in this.room.enemyCreeps) {
				if (hivemind.relations.isAlly(userName)) continue;
				if (userName !== 'Invader') invaderOnly = false;

				const creeps = this.room.enemyCreeps[userName];
				for (const creep of creeps) {
					for (const part of creep.body) {
						let partPower = partStrength[part.type] || 0;
						let boostPower = 1;

						if (part.boost && typeof part.boost === 'string') {
							const effect = BOOSTS[part.type][part.boost];
							boostPower = effect[relevantBoostAttribute[part.type]] || 1;

							if (part.type === TOUGH) {
								partPower = 100;
								boostPower = 1 / (effect.damage || 1);
							}
						}

						if (([ATTACK, RANGED_ATTACK, CLAIM, WORK] as BodyPartConstant[]).includes(part.type)) {
							attackStrength += partPower * boostPower;
						}

						if (part.type === HEAL) {
							healStrength += partPower * boostPower;
						}

						totalStrength += partPower * boostPower;
					}
				}
			}

			const towerStrength = TOWER_POWER_ATTACK * (this.room.myStructuresByType[STRUCTURE_TOWER] || []).length / 2;

			// Active defense is calculated as having 2 creeps
			// with 50% attack and move parts.
			const defensiveCreepStrength = 2 * ATTACK_POWER * Math.min(MAX_CREEP_SIZE / 2, Math.floor(this.room.energyCapacityAvailable / (BODYPART_COST[ATTACK] + BODYPART_COST[MOVE])));

			// @todo Factor in if we can use boosts on defense creeps.
			const defenseBoostPower = 1;

			// If the enemy can take down a piece of wall in < 3000 ticks, that's a problem.
			const normalDamageThreshold = this.getLowestWallStrength() / 3000;

			// If the enemy can take down a piece of wall in < 1000 ticks, that's a big problem.
			const highDamageThreshold = this.getLowestWallStrength() / 1000;

			if (attackStrength === 0) return ENEMY_STRENGTH_NONE;
			if (invaderOnly || (healStrength < towerStrength && attackStrength < highDamageThreshold)) return ENEMY_STRENGTH_WEAK;
			if (healStrength < towerStrength + defensiveCreepStrength && attackStrength > normalDamageThreshold) return ENEMY_STRENGTH_NORMAL;
			if (healStrength < towerStrength + defensiveCreepStrength * defenseBoostPower && attackStrength > highDamageThreshold) return ENEMY_STRENGTH_STRONG;

			return ENEMY_STRENGTH_DEADLY;
		});
	}

	openRampartsToFriendlies() {
		if (_.size(this.room.enemyCreeps) === 0) {
			if (this.memory.lastActivity && Game.time - this.memory.lastActivity > 10) {
				// Close ramparts after last friendly leaves the room for a while.
				const ramparts = this.room.myStructuresByType[STRUCTURE_RAMPART];
				_.each(ramparts, rampart => {
					if (rampart.isPublic) rampart.setPublic(false);
				});
				delete this.memory.lastActivity;
				delete this.memory.creepStatus;
			}

			return;
		}

		this.memory.lastActivity = Game.time;
		if (!this.memory.creepStatus) this.memory.creepStatus = {};

		const allowed = [];
		const forbidden = [];
		_.each(this.room.enemyCreeps, (creeps, username) => {
			const numberInRoom = _.size(_.filter(creeps, creep => this.isInRoom(creep)));

			for (const creep of creeps) {
				this.recordCreepStatus(creep);

				if (!this.isWhitelisted(username) || (!this.isUnarmedCreep(creep) && !hivemind.relations.isAlly(username))) {
					// Deny unwanted creeps.
					forbidden.push(creep);
					continue;
				}

				if (numberInRoom >= hivemind.settings.get('maxVisitorsPerUser') && !this.isInRoom(creep)) {
					// Extra creeps outside are denied entry.
					forbidden.push(creep);
					continue;
				}

				allowed.push(creep);
			}
		});

		const ramparts = this.room.myStructuresByType[STRUCTURE_RAMPART];
		_.each(ramparts, rampart => {
			const newState = this.shouldRampartBePublic(rampart, allowed, forbidden);
			if (rampart.isPublic !== newState) rampart.setPublic(newState);
		});
	}

	recordCreepStatus(creep: Creep) {
		// @todo Detect killed creeps as resources we've gained.

		if (!this.memory.creepStatus[creep.id]) {
			const store = {};
			_.each(creep.store, (amount, resourceType) => {
				store[resourceType] = amount;
			});

			this.memory.creepStatus[creep.id] = {
				store,
			};
		}

		const memory = this.memory.creepStatus[creep.id];
		if (memory.isThief) return;

		// Detect if creep has gained resources.
		for (const resourceType of getResourcesIn(creep.store)) {
			const amount = creep.store.getUsedCapacity(resourceType);
			if (amount !== (memory.store[resourceType] || 0)) {
				const creepGained = amount - (memory.store[resourceType] || 0);
				// We lost any resource the creep gained.
				this.calculatePlayerTrade(creep.owner.username, -creepGained, resourceType);
				// @todo Set `memory.isThief = true` when too many resources have been
				// taken.
			}

			memory.store[resourceType] = amount;
		}

		for (const resourceType of getResourcesIn(memory.store)) {
			const amount = memory.store[resourceType];
			if (!creep.store[resourceType]) {
				// If the creep lost a resource, we gained as much.
				this.calculatePlayerTrade(creep.owner.username, amount, resourceType);
				delete memory.store[resourceType];
			}
		}
	}

	calculatePlayerTrade(username: string, amount: number, resourceType: ResourceConstant) {
		const opName = 'playerTrade:' + username;
		const operation = Game.operations[opName] || new Operation(opName);

		operation.addResourceGain(amount, resourceType);

		hivemind.log('trade', this.roomName).notify('Trade with', username, ':', amount, resourceType);
	}

	isThief(creep: Creep): boolean {
		if (!this.memory.creepStatus) return false;
		if (!this.memory.creepStatus[creep.id]) return false;
		if (!this.memory.creepStatus[creep.id].isThief) return false;

		// @todo Mark as thief if player stole too many resources.

		return true;
	}

	/**
	 * Determines if a rampart should be opened or closed.
	 */
	shouldRampartBePublic(rampart: StructureRampart, allowed: Creep[], forbidden: Creep[]): boolean {
		if (allowed.length === 0) return false;
		if (forbidden.length === 0) return true;

		for (const creep of forbidden) {
			if (creep.pos.getRangeTo(rampart) <= 3) return false;
		}

		return true;
	}

	/**
	 * Checks if a creep is considered harmless.
	 */
	isUnarmedCreep(creep: Creep): boolean {
		for (const part of creep.body) {
			if (part.type !== MOVE && part.type !== TOUGH && part.type !== CARRY) {
				return false;
			}
		}

		return true;
	}

	isInRoom(creep: Creep): boolean {
		// @todo This is not correct when mincut ramparts are enabled.
		return creep.pos.x > 1 && creep.pos.y > 1 && creep.pos.x < 48 && creep.pos.y < 48;
	}

	isWhitelisted(username: string): boolean {
		return hivemind.relations.isAlly(username) || _.includes(hivemind.settings.get('rampartWhitelistedUsers'), username);
	}
}
