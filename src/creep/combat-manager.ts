import cache from 'utils/cache';
import hivemind from 'hivemind';
import utilities from 'utilities';
import {getResourcesIn} from 'utils/store';
import {handleMapArea} from 'utils/map';

type AttackTarget = Creep | Structure;

interface ScoredPosition {
	pos: RoomPosition;
	score: number;
}

const rangedMassAttackDamage = {
	0: RANGED_ATTACK_POWER,
	1: RANGED_ATTACK_POWER,
	2: RANGED_ATTACK_POWER * 0.4,
	3: RANGED_ATTACK_POWER * 0.1,
};

const TILE_PLAINS = 1;
const TILE_SWAMP = 2;
const TILE_WALL = 3;

export default class CombatManager {
	tileCache: Record<number, number>;
	tileCacheTime: number;

	hasRangedAttacked: boolean;
	hasAttacked: boolean;

	public manageCombatActions(creep: Creep) {
		this.hasAttacked = false;
		this.hasRangedAttacked = false;

		this.attackNearbyTargets(creep);
		this.healNearbyTargets(creep);
	}

	public getMaxAttackRange(creep: Creep): number {
		if (creep.getActiveBodyparts(RANGED_ATTACK) > 0) return 3;
		if (creep.getActiveBodyparts(ATTACK) > 0) return 1;

		return 0;
	}

	public performFleeTowards(creep: Creep, targetPosition: RoomPosition, targetRange: number = 0) {
		if (!this.needsToFlee(creep)) {
			// No danger, We can move to our target normally.
			creep.whenInRange(targetRange, targetPosition, () => {});
		}

		const enemyCreeps = this.getEnemyMilitaryCreeps(creep.room);
		const positions = this.getValidNeighboringPositions(creep.pos);
		const scoredPositions = this.scoreKitingPositions(creep, enemyCreeps, positions, targetPosition);
		if (scoredPositions.length === 0) {
			// We don't know what to do. Guess we just move towards the target position.
			creep.whenInRange(targetRange, targetPosition, () => {});
		}

		const newPosition = _.max(scoredPositions, 'score');
		if (!creep.pos.isEqualTo(newPosition)) creep.move(creep.pos.getDirectionTo(newPosition.pos));

		return;
	}

	public needsToFlee(creep: Creep): boolean {
		const enemyCreeps = this.getEnemyMilitaryCreeps(creep.room);
		if (!this.hasEnemyCreepsInFightingRange(creep, enemyCreeps)) return false;

		return _.some(enemyCreeps, c => !this.couldWinFightAgainst(creep, c));
	}

	public performKitingMovement(creep: Creep, target: AttackTarget) {
		let targetRange = this.getMaxAttackRange(creep);
		if (target instanceof Creep) {
			const isMeleeCreep = target.getActiveBodyparts(ATTACK) > 0;
			if (!isMeleeCreep) targetRange -= 1;
		}

		const positions = this.getValidNeighboringPositions(creep.pos);
		const enemyCreeps = this.getEnemyMilitaryCreeps(creep.room);

		if (this.hasEnemyCreepsInFightingRange(creep, enemyCreeps)) {
			const scoredPositions = this.scoreKitingPositions(creep, enemyCreeps, positions);
			if (scoredPositions.length === 0) {
				// We don't know what to do. Guess we resume chasing our target.
				creep.whenInRange(targetRange, target, () => {});
			}

			const newPosition = _.max(scoredPositions, 'score');
			if (!creep.pos.isEqualTo(newPosition)) creep.move(creep.pos.getDirectionTo(newPosition.pos));

			return;
		}

		// No danger, just keep close to our target to kill it.
		creep.whenInRange(targetRange, target, () => {});
	}

	public hasEnemyCreepsInFightingRange(creep: Creep, enemyCreeps?: Creep[]): boolean {
		return _.any(enemyCreeps ?? this.getEnemyMilitaryCreeps(creep.room), c => c.pos.getRangeTo(creep) <= (c.owner.username === 'Source Keeper' ? 3 : 5));
	}

	public getEnemyMilitaryCreeps(room: Room): Creep[] {
		return cache.inObject(room, 'enemyMilitaryCreeps', 1, () => {
			const creeps = [];
			for (const userName in room.enemyCreeps) {
				if (hivemind.relations.isAlly(userName)) continue;
				for (const enemyCreep of room.enemyCreeps[userName]) {
					// Ignore creeps that are not dangerous to us.
					if (
						enemyCreep.getActiveBodyparts(ATTACK) === 0
						&& enemyCreep.getActiveBodyparts(RANGED_ATTACK) === 0
					) continue;

					creeps.push(enemyCreep);
				}
			}

			return creeps;
		});
	}

	public couldWinFightAgainst(creep: Creep, otherCreep: Creep): boolean {
		if (creep.room.isMine() && creep.room.controller.safeMode) return true;

		const towerHealPower = this.getTowerHealPower(creep);
		const activeAllies = this.getAlliedCombatCreeps(creep.pos);
		const attackParts = creep.getActiveBodyparts(ATTACK) + _.sum(activeAllies, c => c.getActiveBodyparts(ATTACK)) * 0.5;
		const healParts = creep.getActiveBodyparts(HEAL) + _.sum(activeAllies, c => c.getActiveBodyparts(HEAL)) * 0.5;
		const rangedAttackParts = creep.getActiveBodyparts(RANGED_ATTACK) + _.sum(activeAllies, c => c.getActiveBodyparts(RANGED_ATTACK)) * 0.5;

		if (
			(
				creep.getActiveBodyparts(RANGED_ATTACK) > 0
				|| (creep.getActiveBodyparts(ATTACK) > 0 && otherCreep.getActiveBodyparts(RANGED_ATTACK) === 0)
			)
			&& otherCreep.getActiveBodyparts(HEAL) === 0
			&& creep.hits === creep.hitsMax
		) {
			// Take pot shots at creeps that can't heal.
			return true;
		}

		if (
			creep.getActiveBodyparts(RANGED_ATTACK) > 0
			&& rangedAttackParts * RANGED_ATTACK_POWER > otherCreep.getActiveBodyparts(HEAL) * HEAL_POWER
			&& otherCreep.getActiveBodyparts(RANGED_ATTACK) === 0
		) return true;

		if (rangedAttackParts * RANGED_ATTACK_POWER + healParts * HEAL_POWER + towerHealPower > otherCreep.getActiveBodyparts(HEAL) * HEAL_POWER + otherCreep.getActiveBodyparts(RANGED_ATTACK) * RANGED_ATTACK_POWER) {
			return true;
		}

		if (
			attackParts > otherCreep.getActiveBodyparts(ATTACK)
			&& attackParts * ATTACK_POWER > otherCreep.getActiveBodyparts(HEAL) * HEAL_POWER
			&& healParts * HEAL_POWER + towerHealPower >= otherCreep.getActiveBodyparts(RANGED_ATTACK) * RANGED_ATTACK_POWER
		) return true;

		return false;
	}

	public getTowerHealPower(creep: Creep): number {
		if (!creep.room.isMine()) return 0;

		let total = 0;
		for (const tower of creep.room.myStructuresByType[STRUCTURE_TOWER] || []) {
			if (tower.store.getUsedCapacity(RESOURCE_ENERGY) < TOWER_ENERGY_COST) continue;

			total += TOWER_POWER_HEAL * tower.getPowerAtRange(creep.pos.getRangeTo(tower));
		}

		return total;
	}

	public getAlliedCombatCreeps(position: RoomPosition): Creep[] {
		const allies = [];
		const room = Game.rooms[position.roomName];
		if (!room) return allies;

		for (const creep of Object.values(room.creeps)) {
			if (!creep.my) continue;
			if (creep.pos.getRangeTo(position) > 5) continue;
			if (creep.getActiveBodyparts(ATTACK) === 0 && creep.getActiveBodyparts(RANGED_ATTACK) === 0 && creep.getActiveBodyparts(HEAL) === 0) continue;

			allies.push(creep);
		}

		for (const userName in room.enemyCreeps) {
			if (!hivemind.relations.isAlly(userName)) continue;

			for (const creep of room.enemyCreeps[userName]) {
				if (creep.pos.getRangeTo(position) > 3) continue;
				if (creep.getActiveBodyparts(ATTACK) === 0 && creep.getActiveBodyparts(RANGED_ATTACK) === 0 && creep.getActiveBodyparts(HEAL) === 0) continue;

				allies.push(creep);
			}
		}

		return allies;
	}

	public getMostValuableTarget(creep: Creep, targets?: AttackTarget[]): AttackTarget | null {
		if (!targets) targets = this.getAllTargetsInRoom(creep.room);

		const scoredTargets = this.scoreTargets(creep, targets);

		const bestTarget = utilities.getBestOption(scoredTargets);
		return bestTarget?.object;
	}

	private healNearbyTargets(creep: Creep) {
		const healParts = creep.getActiveBodyparts(HEAL);
		if (healParts === 0) return;

		const targets = creep.pos.findInRange(FIND_CREEPS, 3, {
			// @todo Allow full-health creeps when pre-healing makes sense.
			filter: c => c.hits < c.hitsMax && (c.my || hivemind.relations.isAlly(c.owner.username)),
		});

		const target = _.max(targets, c => Math.min(
			c.hitsMax - c.hits,
			// @todo Factor in boosts.
			healParts * (c.pos.getRangeTo(creep) <= 1 ? HEAL_POWER : RANGED_HEAL_POWER),
		));
		// @todo Handle the fact that we can't melee attack and heal at the same time.
		if (target) {
			if (creep.pos.getRangeTo(target.pos) <= 1) {
				if (!this.hasAttacked) creep.heal(target);
			}
			else if (!this.hasAttacked && !this.hasRangedAttacked) creep.rangedHeal(target);
		}
	}

	private attackNearbyTargets(creep: Creep) {
		const availableTargets = this.getNearbyTargets(creep);
		if (availableTargets.length === 0) return;

		const availableOwnedTargets = _.filter(availableTargets, target => ('owner' in target) && target?.owner?.username);

		if (creep.getActiveBodyparts(RANGED_ATTACK) > 0) {
			if (availableOwnedTargets.length >= 2 && this.determineMassAttackDamage(creep, availableOwnedTargets) > RANGED_ATTACK_POWER) {
				// @todo Ideally, even involve score from `scoreTargets()`.
				creep.rangedMassAttack();
				this.hasRangedAttacked = true;
				return;
			}

			this.hasRangedAttacked = true;
			creep.rangedAttack(this.getMostValuableTarget(creep, availableTargets));
			return;
		}

		if (creep.getActiveBodyparts(ATTACK) > 0) {
			this.hasAttacked = true;
			creep.attack(this.getMostValuableTarget(creep, availableTargets));
		}
	}

	private determineMassAttackDamage(creep: Creep, targets: AttackTarget[]): number {
		let total = 0;
		for (const target of targets) {
			total += rangedMassAttackDamage[creep.pos.getRangeTo(target.pos)];
		}

		return total;
	}

	private getNearbyTargets(creep: Creep): AttackTarget[] {
		const availableTargets: AttackTarget[] = [];
		const maxRange = this.getMaxAttackRange(creep);

		for (const enemyName in creep.room.enemyCreeps) {
			if (hivemind.relations.isAlly(enemyName)) continue;

			for (const target of creep.room.enemyCreeps[enemyName]) {
				if (creep.pos.getRangeTo(target) > maxRange) continue;

				availableTargets.push(target);
			}
		}

		// @todo Add construction sites (that have build progress) to run over.
		// @todo Add structures in range only if room is not owned by an ally.
		// @todo Add power creeps
		// @todo Use same filters here and in `getAllTargetsInRoom`.
		const isMyRoom = creep.room.isMine()
			|| hivemind.relations.isAlly(creep.room.controller?.owner?.username)
			|| hivemind.relations.isAlly(creep.room.controller?.reservation?.username)
			|| (Memory.strategy?.remoteHarvesting?.rooms || []).includes(creep.room.name);
		for (const structure of creep.pos.findInRange(FIND_STRUCTURES, maxRange)) {
			if (!structure.hits) continue;
			if ('owner' in structure && hivemind.relations.isAlly(structure.owner?.username)) continue;
			if (!('owner' in structure) && isMyRoom) continue;

			availableTargets.push(structure);
		}

		return availableTargets;
	}

	private getValidNeighboringPositions(position: RoomPosition) {
		const positions: RoomPosition[] = [];
		handleMapArea(position.x, position.y, (x, y) => {
			const newPosition = new RoomPosition(x, y, position.roomName);
			if (this.isTileWall(newPosition)) return;

			positions.push(newPosition);
		});

		return positions;
	}

	private scoreKitingPositions(creep: Creep, enemyCreeps: Creep[], positions: RoomPosition[], targetPosition?: RoomPosition): ScoredPosition[] {
		const scored = _.map(positions, pos => ({
			pos,
			score: 0,
		}));

		// @todo Prefer positions where we can do a high amount of RMA damage.
		this.addPositionRangeScore(creep, targetPosition ?? new RoomPosition(25, 25, creep.room.name), scored);
		this.addTerrainScore(creep, enemyCreeps, scored);
		this.addEnemyRangeScore(creep, enemyCreeps, scored);

		return scored;
	}

	private addPositionRangeScore(creep: Creep, targetPosition: RoomPosition, positions: ScoredPosition[]) {
		if (targetPosition.roomName !== creep.room.name) {
			// @todo Find out which exit we'd need to path to.
			return;
		}

		for (const position of positions) {
			const range = position.pos.getRangeTo(targetPosition);
			position.score -= range * (0.9 + (range / 10));
			position.score -= Math.min(Math.abs(targetPosition.x - position.pos.x), Math.abs(targetPosition.y - position.pos.y));
		}
	}

	private addTerrainScore(creep: Creep, enemyCreeps: Creep[], positions: ScoredPosition[]) {
		const isFleeing = _.some(enemyCreeps, c => !this.couldWinFightAgainst(creep, c));

		for (const position of positions) {
			if (this.isTileSwamp(position.pos)) position.score -= 100;
			// @todo Check what room it at the other side of the exit to
			// determine how bad leaving in that direction would be.
			if (
				position.pos.x === 0
				|| position.pos.x === 49
				|| position.pos.y === 0
				|| position.pos.y === 49
			) position.score += isFleeing ? 200 : -200;

			handleMapArea(position.pos.x, position.pos.y, (x, y) => {
				const pos = new RoomPosition(x, y, position.pos.roomName);
				if (this.isTileWall(pos)) position.score -= 20;
				if (this.isTileSwamp(pos)) position.score -= 10;
				if (x === 0 || x === 49 || y === 0 || y === 49) position.score += isFleeing ? 20 : -20;
			}, 2);
		}
	}

	private isTileWall(pos: RoomPosition): boolean {
		const encodedPos = pos.roomName + ':' + (pos.x + (50 * pos.y));
		this.generateTileCache(pos, encodedPos);

		return this.tileCache[encodedPos] === TILE_WALL;
	}

	private isTileSwamp(pos: RoomPosition): boolean {
		const encodedPos = pos.roomName + ':' + (pos.x + (50 * pos.y));
		this.generateTileCache(pos, encodedPos);

		return this.tileCache[encodedPos] === TILE_SWAMP;
	}

	private isTilePlains(pos: RoomPosition): boolean {
		const encodedPos = pos.roomName + ':' + (pos.x + (50 * pos.y));
		this.generateTileCache(pos, encodedPos);

		return this.tileCache[encodedPos] === TILE_PLAINS;
	}

	private generateTileCache(pos: RoomPosition, encodedPos: string) {
		if (this.tileCacheTime !== Game.time) {
			this.tileCache = {};
			this.tileCacheTime = Game.time;
		}

		if (this.tileCache[encodedPos]) return;

		const terrain = new Room.Terrain(pos.roomName);
		const structures = pos.lookFor(LOOK_STRUCTURES);
		if (terrain.get(pos.x, pos.y) & TERRAIN_MASK_WALL && !_.some(structures, s => s.structureType === STRUCTURE_ROAD)) {
			this.tileCache[encodedPos] = TILE_WALL;
			return;
		}

		if (_.any(structures, s => !s.isWalkable())) {
			this.tileCache[encodedPos] = TILE_WALL;
			return;
		}

		if (terrain.get(pos.x, pos.y) & TERRAIN_MASK_SWAMP && !_.some(structures, s => s.structureType === STRUCTURE_ROAD)) {
			this.tileCache[encodedPos] = TILE_SWAMP;
			return;
		}

		this.tileCache[encodedPos] = TILE_PLAINS;
	}

	private addEnemyRangeScore(creep: Creep, enemyCreeps: Creep[], positions: ScoredPosition[]) {
		const maxRange = this.getMaxAttackRange(creep);
		const isRangedCreep = maxRange > 1;

		// @todo Corner positions are beneficial when we're fleeing, and
		// problematic when we're chasing.

		for (const enemy of enemyCreeps) {
			// @todo for strong enemy creeps, we might actually prefer
			// staying out of its range to getting into range (>=5).

			const willFight = this.couldWinFightAgainst(creep, enemy);
			const isEnemyMeleeCreep = enemy.getActiveBodyparts(ATTACK) > 0 && enemy.getActiveBodyparts(RANGED_ATTACK) === 0;
			const mightMoveTowardsUs = enemy.getActiveBodyparts(MOVE) > 0 && enemy.fatigue === 0;

			for (const position of positions) {
				const distance = position.pos.getRangeTo(enemy.pos);

				if (distance > maxRange) {
					position.score -= (willFight ? (isRangedCreep ? 10 : 30) : -50) * (distance - maxRange);
					continue;
				}

				const enemyRange = (isEnemyMeleeCreep ? 1 : 3) + (mightMoveTowardsUs ? 1 : 0);
				if (!willFight) {
					if (distance <= enemyRange) position.score -= 2500;
					continue;
				}

				// @todo Instead of doing these range preferences, we should calculate the possible incoming damage for
				// a tile and check whether we could heal against it.
				if (isRangedCreep) {
					// Don't get too close, but prefer range 2 for easier chasing
					// unless we're fighting a melee creep that might move towards us.
					if (distance < 2) position.score -= 500;
					if (distance === 2) position.score += isEnemyMeleeCreep ? 300 : 1000;
					if (distance === 3) position.score += isEnemyMeleeCreep ? 1000 : 300;
				}
				else {
					// Prefer moving onto the enemy tile, so we can keep
					// chasing.
					if (distance === 0) position.score += 1000;
					if (distance === 1) position.score += 300;
				}
			}
		}
	}

	private getAllTargetsInRoom(room: Room): AttackTarget[] {
		const allTargets = [];

		// Attack harvest / transport creeps, ideally those with energy in them.
		for (const enemyName in room.enemyCreeps) {
			if (hivemind.relations.isAlly(enemyName)) continue;

			for (const target of room.enemyCreeps[enemyName]) {
				// @todo Avoid military creeps that are too strong for us.
				allTargets.push(target);
			}
		}

		// @todo Also consider rooms on the path of harvesting operations
		// as my rooms.
		const isMyRoom = room.isMine()
			|| hivemind.relations.isAlly(room.controller?.owner?.username)
			|| hivemind.relations.isAlly(room.controller?.reservation?.username)
			|| (Memory.strategy?.remoteHarvesting?.rooms || []).includes(room.name);
		// Attack containers, roads and other infrastructure.
		for (const structure of room.structures) {
			if (!structure.hits) continue;
			if ('owner' in structure && hivemind.relations.isAlly(structure.owner?.username)) continue;
			if (!('owner' in structure) && isMyRoom) continue;

			allTargets.push(structure);
		}

		// @todo Attack / stomp construction sites.
		// @todo Attack power creeps.

		return allTargets;
	}

	private scoreTargets(creep: Creep, targets: AttackTarget[]): Array<{
		weight: number;
		priority: number;
		object: AttackTarget;
	}> {
		return _.map(
			targets,
			target => {
				let priority = 0;
				let weight = 0;
				// @todo Containers and roads are only relevant targets if the room is
				// owned / harvested by another player.
				if ('structureType' in target) {
					if (target.structureType === STRUCTURE_INVADER_CORE) priority = 4;
					if (target.structureType === STRUCTURE_TOWER) priority = 3;
					if (target.structureType === STRUCTURE_CONTAINER) priority = 2;
					if (target.structureType === STRUCTURE_ROAD) priority = 1;
					weight = 1 - (target.hits / target.hitsMax);
				}
				else {
					// @todo Prioritize boosted creeps.
					priority = 3 - (this.couldWinFightAgainst(creep, target) ? 0 : 2);
					// Prioritize killing damaged creeps.
					weight = (1 - (target.hits / target.hitsMax)) * 2;
					// Prioritize close creeps we can actually reach.
					weight -= target.pos.getRangeTo(creep.pos) / 20;
					// Prioritize creeps that still have a long TTL.
					weight += target.ticksToLive / (target.getActiveBodyparts(CLAIM) > 0 ? CREEP_CLAIM_LIFE_TIME : CREEP_LIFE_TIME);
					// Prioritize creeps with expensive body parts.
					weight += this.getBodyValue(target) / BODYPART_COST[CLAIM];
					// Prioritize creeps carrying expensive goods.
					weight += this.getStoreValue(target) / CARRY_CAPACITY;
				}

				return {
					priority,
					weight,
					object: target,
				};
			},
		);
	}

	private getBodyValue(target: Creep): number {
		let total = 0;
		for (const part of target.body) {
			total += BODYPART_COST[part.type];
		}

		return total / target.body.length;
	}

	private getStoreValue(target: Creep): number {
		let total = 0;
		for (const resourceType of getResourcesIn(target.store)) {
			// @todo Weigh depending on resource type.
			total += target.store.getUsedCapacity(resourceType);
		}

		return total / target.body.length;
	}
}
