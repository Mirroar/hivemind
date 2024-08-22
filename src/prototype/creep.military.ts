/* global Creep ATTACK RANGED_ATTACK HEAL MOVE TOUGH BOOSTS
ATTACK_POWER HEAL_POWER RANGED_ATTACK_POWER RANGED_HEAL_POWER */

import hivemind from 'hivemind';

declare global {
	interface Creep {
		isDangerous: () => boolean;
		getEffectiveHealth: () => number;
		getDamageCapacity: (range: number) => number;
		getHealCapacity: (range: number) => number;
		getEffectiveDamage: (potentialDamage: number) => number;
	}

	interface PowerCreep {
		isDangerous: () => boolean;
		getEffectiveHealth: () => number;
		getDamageCapacity: (range: number) => number;
		getHealCapacity: (range: number) => number;
		getEffectiveDamage: (potentialDamage: number) => number;
	}
}

const stompingCreeps: Record<string, boolean> = {};

/**
 * Determines if a creep is dangerous and should be attacked.
 *
 * @return {boolean}
 *   True if the creep can be considered dangerous in some way.
 */
Creep.prototype.isDangerous = function (this: Creep) {
	if (hivemind.relations.isAlly(this.owner.username)) return false;

	const isInMyRoom = this.room.isMine();

	for (const part of this.body) {
		if (
			part.type !== MOVE
			&& part.type !== TOUGH
			&& (isInMyRoom || part.type !== WORK)
			&& (isInMyRoom || part.type !== CARRY)
		) {
			return true;
		}
	}

	if (mightStompConstructionSites(this, isInMyRoom)) return true;

	return false;
};

function mightStompConstructionSites(creep: Creep, isInMyRoom: boolean): boolean {
	// We don't care about creeps stomping construction sites in rooms
	// outside our own.
	if (!isInMyRoom) return false;

	// Creeps that are about to stomp our construction sites are also considered
	// dangerous.
	if (stompingCreeps[creep.id]) return true;

	// @todo This check seems expensive. Maybe cache it for a tick?
	const site = creep.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES);
	if (site && site.pos.getRangeTo(creep.pos) <= 5) {
		stompingCreeps[creep.id] = true;
		return true;
	}

	return false;
}

PowerCreep.prototype.isDangerous = function (this: PowerCreep) {
	if (hivemind.relations.isAlly(this.owner.username)) return false;

	return true;
};

Creep.prototype.getEffectiveHealth = function (this: Creep) {
	// @todo Cache for one tick?
	let total = 0;

	for (const part of this.body) {
		if (part.hits === 0) continue;
		if (part.boost) {
			const effects = BOOSTS[part.type][part.boost] as Record<string, number>;
			if (effects.damage) {
				total += part.hits / effects.damage;
				continue;
			}
		}

		total += part.hits;
	}

	return total;
};

PowerCreep.prototype.getEffectiveHealth = function (this: PowerCreep) {
	return this.hits;
};

Creep.prototype.getDamageCapacity = function (this: Creep, range) {
	// @todo Cache for one tick?
	let total = 0;
	if (range > 3) return total;

	for (const part of this.body) {
		if (part.hits === 0) continue;

		if (part.type === ATTACK) {
			if (range > 1) continue;
			if (part.boost) {
				const effects = BOOSTS[part.type][part.boost];
				if (effects.attack) {
					total += ATTACK_POWER * effects.attack;
					continue;
				}
			}

			total += ATTACK_POWER;
			continue;
		}

		if (part.type !== RANGED_ATTACK) continue;
		if (part.boost) {
			const effects = BOOSTS[part.type][part.boost];
			if (effects.rangedAttack) {
				total += RANGED_ATTACK_POWER * effects.rangedAttack;
				continue;
			}
		}

		total += RANGED_ATTACK_POWER;
	}

	return total;
};

PowerCreep.prototype.getDamageCapacity = function () {
	return 0;
};

Creep.prototype.getHealCapacity = function (this: Creep, range) {
	// @todo Cache for one tick?
	let total = 0;
	if (range > 3) return total;
	const power = range === 1 ? HEAL_POWER : RANGED_HEAL_POWER;

	for (const part of this.body) {
		if (part.hits === 0) continue;
		if (part.type !== HEAL) continue;
		if (part.boost) {
			const effects = BOOSTS[part.type][part.boost];
			if (effects.heal) {
				total += power * effects.heal;
				continue;
			}
		}

		total += power;
	}

	return total;
};

PowerCreep.prototype.getHealCapacity = function () {
	return 0;
};

Creep.prototype.getEffectiveDamage = function (this: Creep, potentialDamage) {
	let total = 0;
	let damageTaken = 0;

	for (const part of this.body) {
		if (damageTaken >= potentialDamage) break;
		if (part.hits === 0) continue;

		if (part.type !== TOUGH) {
			const damage = Math.min(part.hits, potentialDamage - damageTaken);
			total += damage;
			damageTaken += damage;
			continue;
		}

		let multiplier = 1;
		if (part.boost) {
			const effects = BOOSTS[part.type][part.boost];
			if (effects.damage) {
				multiplier = 1 / effects.damage;
			}
		}

		const damage = Math.min(part.hits * multiplier, potentialDamage - damageTaken);
		total += damage / multiplier;
		damageTaken += damage;
	}

	// Add overkill damage in full.
	total += potentialDamage - damageTaken;

	return total;
};

PowerCreep.prototype.getEffectiveDamage = function () {
	return 0;
};
