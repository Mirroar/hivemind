/* global Creep Room FIND_CREEPS BOOSTS ATTACK
RANGED_ATTACK HEAL STRUCTURE_TOWER TOWER_POWER_HEAL TOWER_POWER_ATTACK
ATTACK_POWER RANGED_ATTACK_POWER HEAL_POWER RANGED_HEAL_POWER
CARRY CLAIM MOVE TOUGH WORK TOWER_ENERGY_COST */

import hivemind from 'hivemind';
import cache from 'utils/cache';

declare global {
	interface Room {
		assertMilitarySituation: () => void;
		assertMilitaryCreepPower: (creep: Creep | PowerCreep) => void;
		assertMilitaryStructurePower: (structure: Structure) => void;
		addMilitaryAssertion: (x: number, y: number, amount: number, type: string) => void;
		getMilitaryAssertion: (x: number, y: number, type: string) => number;
		assertTargetPriorities: () => void;
		getTowerTarget: () => Creep | null;
		drawMilitarySituation: () => void;

		_sitRepBuilt: boolean;
		sitRep: SitRep;
		militaryObjects: {
			creeps: Array<Creep | PowerCreep>;
			structures: Structure[];
			myCreeps: Array<Creep | PowerCreep>;
			myStructures: Structure[];
		};
	}

	interface Creep {
		getMilitaryValue: () => number;

		militaryPriority: number;
	}

	interface PowerCreep {
		getMilitaryValue: () => number;

		militaryPriority: number;
	}
}

interface SitRep {
	damage: Record<number, Record<number, number>>;
	healing: Record<number, Record<number, number>>;
	myDamage: Record<number, Record<number, number>>;
	myHealing: Record<number, Record<number, number>>;
}

/**
 * Scans the room for military targets, grades them, etc.
 */
Room.prototype.assertMilitarySituation = function (this: Room) {
	if (this._sitRepBuilt) return;

	this._sitRepBuilt = true;
	this.sitRep = {
		damage: {},
		healing: {},
		myDamage: {},
		myHealing: {},
	};

	this.militaryObjects = {
		creeps: [],
		structures: [],
		myCreeps: [],
		myStructures: [],
	};

	// @todo Look for enemy towers.
	// @todo Look for weak walls.
	// @todo Take enemy healing possibilities into account.
	// @todo Take into account that attacking melee creeps retaliates.
	// @todo Factor in boosts.

	// Parse military creeps in the room.
	const creeps = this.find(FIND_CREEPS);
	for (const creep of creeps) {
		if (creep.my) {
			// @todo Filter out civilian creeps to save on CPU.
			this.militaryObjects.myCreeps.push(creep);
		}
		else if (creep.isDangerous() && !hivemind.relations.isAlly(creep.owner.username)) {
			this.militaryObjects.creeps.push(creep);
		}
	}

	const powerCreeps = this.find(FIND_POWER_CREEPS);
	for (const powerCreep of powerCreeps) {
		if (powerCreep.my) {
			// @todo Filter out civilian creeps to save on CPU.
			this.militaryObjects.myCreeps.push(powerCreep);
		}
		else if (powerCreep.isDangerous() && !hivemind.relations.isAlly(powerCreep.owner.username)) {
			this.militaryObjects.creeps.push(powerCreep);
		}
	}

	// Parse military structures in the room.
	for (const structure of (this.structuresByType[STRUCTURE_TOWER] || [])) {
		this.assertMilitaryStructurePower(structure);
	}

	// Calculate values for all actors.
	for (const creep of this.militaryObjects.creeps) {
		this.assertMilitaryCreepPower(creep);
	}

	for (const creep of this.militaryObjects.myCreeps) {
		this.assertMilitaryCreepPower(creep);
	}

	// Determine target priorities from calculated values.
	this.assertTargetPriorities();

	// @todo Look for safe places in movement range.

	this.drawMilitarySituation();
};

/**
 * Estimate a creep's military capabilities.
 *
 * @param {Creep} creep
 *   The creep to asses.
 */
Room.prototype.assertMilitaryCreepPower = function (this: Room, creep: Creep | PowerCreep) {
	let hostile: boolean;
	let targets: Array<Creep | PowerCreep>;
	let allies: Array<Creep | PowerCreep>;
	if (creep.my) {
		hostile = false;
		targets = this.militaryObjects.creeps;
		allies = this.militaryObjects.myCreeps;
	}
	else {
		this.visual.circle(creep.pos, {
			fill: 'transparent',
			stroke: 'red',
			radius: 0.45,
		});

		hostile = true;
		targets = this.militaryObjects.myCreeps;
		allies = this.militaryObjects.creeps;
	}

	// No need to do damage / healing calculations for power creeps.
	if (!(creep instanceof Creep)) return;

	// @todo Move boosted part calculation into a creep function.
	// @todo Factor in which parts get damaged first.
	const totalParts: Partial<Record<BodyPartConstant, number>> = {};
	for (const part of creep.body) {
		if (part.hits === 0) {
			// Body part is disabled.
			continue;
		}

		let amount = 1;
		if (part.boost) {
			if (part.type === ATTACK && BOOSTS[ATTACK][part.boost].attack) {
				amount *= BOOSTS[ATTACK][part.boost].attack;
			}
			else if (part.type === RANGED_ATTACK && BOOSTS[RANGED_ATTACK][part.boost].rangedAttack) {
				amount *= BOOSTS[RANGED_ATTACK][part.boost].rangedAttack;
			}
			else if (part.type === HEAL && BOOSTS[HEAL][part.boost].heal) {
				amount *= BOOSTS[HEAL][part.boost].heal;
			}
		}

		totalParts[part.type] = (totalParts[part.type] || 0) + amount;
	}

	const assertAllTargets = (targets: Array<Creep | PowerCreep>, range: number, amount: number, type: string) => {
		if (amount <= 0) return;

		for (const target of targets) {
			const pos = target.pos;
			if (creep.pos.getRangeTo(pos) > range) continue;

			this.addMilitaryAssertion(pos.x, pos.y, amount, type);
		}
	};

	// @todo Factor in creeps with WORK parts for doing 50 structure damage per tick.
	assertAllTargets(targets, 1, ATTACK_POWER * totalParts[ATTACK], hostile ? 'damage' : 'myDamage');

	// No need to factor in potential explosion use, as it does the same
	// or less damage per tick as a ranged attack.
	assertAllTargets(targets, 3, RANGED_ATTACK_POWER * totalParts[RANGED_ATTACK], hostile ? 'damage' : 'myDamage');

	assertAllTargets(allies, 3, RANGED_HEAL_POWER * totalParts[HEAL], hostile ? 'healing' : 'myHealing');
	// We substract RANGED_HEAL_POWER so we don't inflate the actual possible
	// healing value.
	assertAllTargets(allies, 1, (HEAL_POWER - RANGED_HEAL_POWER) * totalParts[HEAL], hostile ? 'healing' : 'myHealing');
};

/**
 * Estimate a structure's military capabilities.
 *
 * @param {Structure} structure
 *   The structure to asses.
 */
Room.prototype.assertMilitaryStructurePower = function (this: Room, structure: StructureTower) {
	if (structure.store[RESOURCE_ENERGY] < TOWER_ENERGY_COST) return;
	// Don't count our towers if they're almost empty so we don't shoot at targets
	// we can't kill after all.
	if (structure.my && structure.store[RESOURCE_ENERGY] < TOWER_ENERGY_COST * 10) return;

	let hostile: boolean;
	let targets: Array<Creep | PowerCreep>;
	let allies: Array<Creep | PowerCreep>;
	if (structure.my) {
		hostile = false;
		targets = this.militaryObjects.creeps;
		allies = this.militaryObjects.myCreeps;
	}
	else {
		hostile = true;
		targets = this.militaryObjects.myCreeps;
		allies = this.militaryObjects.creeps;
	}

	for (const ally of allies) {
		const pos = ally.pos;
		const power = structure.getPowerAtRange(structure.pos.getRangeTo(pos));
		this.addMilitaryAssertion(pos.x, pos.y, power * TOWER_POWER_HEAL, hostile ? 'healing' : 'myHealing');
	}

	for (const target of targets) {
		const pos = target.pos;
		const power = structure.getPowerAtRange(structure.pos.getRangeTo(pos));
		this.addMilitaryAssertion(pos.x, pos.y, power * TOWER_POWER_ATTACK, hostile ? 'damage' : 'myDamage');
	}

	// @todo Factor repair power.
};

/**
 * Saves military estimate for a certain position.
 *
 * @param {number} x
 *   X position for which to asses the value.
 * @param {number} y
 *   Y position for which to asses the value.
 * @param {number} amount
 *   Amount by which to increment.
 * @param {string} type
 *   The type of value to save.
 */
Room.prototype.addMilitaryAssertion = function (this: Room, x: number, y: number, amount: number, type: string): void {
	if (!amount) return;
	if (x < 0 || x > 49 || y < 0 || y > 49 || amount <= 0) return;

	if (!this.sitRep[type][x]) {
		this.sitRep[type][x] = {};
	}

	this.sitRep[type][x][y] = (this.sitRep[type][x][y] || 0) + amount;
};

/**
 * Returns a military estimate for a position.
 *
 * @param {number} x
 *   X position for which to asses the value.
 * @param {number} y
 *   Y position for which to asses the value.
 * @param {string} type
 *   The type of value to get.
 *
 * @return {number}
 *   Current military assesment of the given type.
 */
Room.prototype.getMilitaryAssertion = function (this: Room, x: number, y: number, type: string) {
	if (this.sitRep[type] && this.sitRep[type][x] && this.sitRep[type][x][y]) {
		return this.sitRep[type][x][y];
	}

	return 0;
};

/**
 * Decides target priority values for all enemy creeps.
 */
Room.prototype.assertTargetPriorities = function (this: Room) {
	// @todo Use target's value / potential damage.
	for (const creep of this.militaryObjects.creeps) {
		const potentialDamage = this.getMilitaryAssertion(creep.pos.x, creep.pos.y, 'myDamage');
		const potentialHealing = this.getMilitaryAssertion(creep.pos.x, creep.pos.y, 'healing');
		// Potential damage is reduced if creep has boosted tough parts.
		const effectiveDamage = creep.getEffectiveDamage(potentialDamage);

		const visual = this.visual;

		const neededDamageFactor = creep.hits === creep.hitsMax ? 1.1 : 1;
		if (effectiveDamage > potentialHealing * neededDamageFactor) {
			creep.militaryPriority = creep.getMilitaryValue() * (effectiveDamage - potentialHealing) * (creep.hitsMax / creep.hits) * creep.ticksToLive / CREEP_LIFE_TIME;
			visual.text(creep.militaryPriority.toPrecision(2), creep.pos.x + 1, creep.pos.y + 0.2, {font: 0.5, color: 'yellow'});
		}
	}
};

/**
 * Chooses the best target for our tower to shoot at.
 *
 * @return {Creep}
 *   An enemy creep to shoot.
 */
Room.prototype.getTowerTarget = function (this: Room) {
	return cache.inObject(this, 'towerTarget', 1, () => {
		this.assertMilitarySituation();
		let max = null;
		for (const creep of this.militaryObjects.creeps) {
			if (!creep.militaryPriority) continue;
			if (creep.militaryPriority <= 0) continue;
			if (max && max.militaryPriority > creep.militaryPriority) continue;

			max = creep;
		}

		if (max) this.visual.circle(max.pos.x, max.pos.y, {radius: 1, fill: 'red', opacity: 0.5});

		return max;
	});
};

/**
 * Uses RoomVisual to visualize military situation in a room.
 */
Room.prototype.drawMilitarySituation = function (this: Room) {
	const visual = this.visual;
	_.each(this.sitRep.damage, (colData, x: string) => {
		_.each(colData, (data, y: string) => {
			visual.text(data.toString(), Number(x), Number(y) - 0.1, {
				color: 'red',
				font: 0.5,
			});
		});
	});

	_.each(this.sitRep.healing, (colData, x: string) => {
		_.each(colData, (data, y: string) => {
			visual.text(data.toString(), Number(x), (Number(y)) + 0.4, {
				color: 'green',
				font: 0.5,
			});
		});
	});

	_.each(this.sitRep.myDamage, (colData, x: string) => {
		_.each(colData, (data, y: string) => {
			visual.text(data.toString(), Number(x), Number(y) - 0.1, {
				color: 'red',
				font: 0.5,
			});
		});
	});

	_.each(this.sitRep.myHealing, (colData, x: string) => {
		_.each(colData, (data, y: string) => {
			visual.text(data.toString(), Number(x), (Number(y)) + 0.4, {
				color: 'green',
				font: 0.5,
			});
		});
	});
};

const bodyPartValues = {
	[ATTACK]: 1,
	[CARRY]: 0,
	[CLAIM]: 10,
	[HEAL]: 5,
	[MOVE]: 0,
	[RANGED_ATTACK]: 2,
	[TOUGH]: 0,
	[WORK]: 1,
};

/**
 * Calculates military value of a creep.
 *
 * @return {number}
 *   The creep's perceived military value.
 */
Creep.prototype.getMilitaryValue = function (this: Creep) {
	// @todo Factor boosts.

	let value = 0;

	for (const part of this.body) {
		const factor = 0.1 + (0.9 * part.hits / 100);

		value += factor * (bodyPartValues[part.type] || 0);
	}

	return value;
};

PowerCreep.prototype.getMilitaryValue = function (this: PowerCreep) {
	return 10 + this.hits / this.hitsMax;
};

export default {

	init() {

		// @todo Add functions to Game context if necessary.

	},

};
