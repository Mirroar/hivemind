'use strict';

/* global hivemind Creep MOVE TOUGH ERR_NOT_ENOUGH_RESOURCES
RESOURCE_ENERGY STRUCTURE_LINK */

/**
 * Determines if a creep is dangerous and should be attacked.
 *
 * @return {boolean}
 *   True if the creep can be considered dangerous in some way.
 */
Creep.prototype.isDangerous = function () {
	if (hivemind.relations.isAlly(this.owner.username)) return false;

	for (const part of this.body) {
		if (part.type !== MOVE && part.type !== TOUGH) {
			return true;
		}
	}

	return false;
};

Creep.prototype.getEffectiveHealth = function () {
	// @todo Cache for one tick?
	let total = 0;

	for (const part of this.body) {
		if (part.hits === 0) continue;
		if (part.boost) {
			const effects = BOOSTS[part.type][part.boost];
			if (effects.damage) {
				total += part.hits / effects.damage;
				continue;
			}
		}

		total += part.hits;
	}

	return total;
};

Creep.prototype.getDamageCapacity = function (range) {
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
			continue
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

Creep.prototype.getHealCapacity = function (range) {
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
