/**
 * Scans the room for military targets, grades them, etc.
 */
Room.prototype.assertMilitarySituation = function () {
	this.sitRep = {
		damage: {},
		healing: {},
		myDamage: {},
		myHealing: {},
	};

	this.militaryObjects = {
		creeps: {},
		structures: {},
		myCreeps: {},
		myStructures: {},
	};

	return;

	// @todo Look for enemy towers.
	// @todo Look for weak walls.
	// @todo Take enemy healing possibilities into account.
	// @todo Take into account that attacking melee creeps retaliates.
	// @todo Factor in boosts.

	// Parse military creeps in the room.
	var creeps = this.find(FIND_CREEPS);
	for (var i in creeps) {
		var creep = creeps[i];

		if (creep.my) {
			// @todo Filter out civilian creeps to save on CPU.
			this.militaryObjects.myCreeps[creep.id] = creep;
		}
		else if (creep.isDangerous()) {
			this.militaryObjects.creeps[creep.id] = creep;
		}
	}

	// Parse military structures in the room.
	var structures = this.find(FIND_STRUCTURES);
	for (var i in structures) {
		var structure = structures[i];
		this.assertMilitaryStructurePower(structure);
	}

	// Calculate values for all actors.
	for (var i in this.militaryObjects.creeps) {
		this.assertMilitaryCreepPower(this.militaryObjects.creeps[i]);
	}
	for (var i in this.militaryObjects.myCreeps) {
		this.assertMilitaryCreepPower(this.militaryObjects.myCreeps[i]);
	}

	// Determine target priorities from calculated values.
	this.assertTargetPriorities();

	// @todo Look for safe places in movement range.

	this.drawMilitarySituation();
};

/**
 * Estimate a creep's military capabilities.
 */
Room.prototype.assertMilitaryCreepPower = function (creep) {
	var hostile;
	var targets;
	var allies;
	if (!creep.my && creep.isDangerous()) {
		this.visual.circle(creep.pos, {
			fill: 'transparent',
			stroke: 'red',
			radius: 0.45,
		});

		hostile = true;
		target = this.militaryObjects.myCreeps;
		allies = this.militaryObjects.creeps;
	}
	else if (creep.my) {
		hostile = false;
		targets = this.militaryObjects.creeps;
		allies = this.militaryObjects.myCreeps;
	}
	else {
		return;
	}

	// @todo Move boosted part calculation into a creep function.
	// @todo Factor in which parts get damaged first.
	var totalParts = {};
	for (var j in creep.body) {
		var type = creep.body[j].type;

		if (creep.body[j].hits == 0) {
			// Body part is disabled.
			continue;
		}

		var amount = 1;
		if (creep.body[j].boost) {
			if (type == ATTACK && BOOSTS[ATTACK][creep.body[j].boost].attack) {
				amount *= BOOSTS[ATTACK][creep.body[j].boost].attack;
			}
			else if (type == RANGED_ATTACK && BOOSTS[RANGED_ATTACK][creep.body[j].boost].rangedAttack) {
				amount *= BOOSTS[RANGED_ATTACK][creep.body[j].boost].rangedAttack;
			}
			else if (type == HEAL && BOOSTS[HEAL][creep.body[j].boost].heal) {
				amount *= BOOSTS[HEAL][creep.body[j].boost].heal;
			}
		}

		totalParts[type] = (totalParts[type] || 0) + amount;
	}

	// @todo Factor in creeps with WORK parts for doing 50 structure damage per tick.
	// @todo Check if there is are constants for damage and healing numbers.
	if (totalParts[ATTACK] > 0) {
		for (var i in targets) {
			var pos = targets[i].pos;
			if (creep.pos.getRangeTo(pos) <= 1) {
				this.addMilitaryAssertion(pos.x, pos.y, 30 * totalParts[ATTACK], hostile && 'damage' || 'myDamage');
			}
		}
	}
	if (totalParts[RANGED_ATTACK] > 0) {
		for (var i in targets) {
			var pos = targets[i].pos;
			if (creep.pos.getRangeTo(pos) <= 1) {
				// No need to factor in potential explosion use, as it does the same
				// or less damage as a ranged attack.
				this.addMilitaryAssertion(pos.x, pos.y, 10 * totalParts[RANGED_ATTACK], hostile && 'damage' || 'myDamage');
			}
		}
	}
	if (totalParts[HEAL] > 0) {
		for (var i in allies) {
			var pos = allies[i].pos;
			if (creep.pos.getRangeTo(pos) <= 1) {
				this.addMilitaryAssertion(pos.x, pos.y, 12 * totalParts[HEAL], hostile && 'healing' || 'myHealing');
			}
			else if (creep.pos.getRangeTo(pos) <= 3) {
				this.addMilitaryAssertion(pos.x, pos.y, 4 * totalParts[HEAL], hostile && 'healing' || 'myHealing');
			}
		}
	}
};

/**
 * Estimate a structure's military capabilities.
 */
Room.prototype.assertMilitaryStructurePower = function (structure) {
	if (structure.structureType != STRUCTURE_TOWER) return;

	var hostile;
	var targets;
	var allies;
	if (!structure.my) {
		hostile = true;
		target = this.militaryObjects.myCreeps;
		allies = this.militaryObjects.creeps;
	}
	else {
		hostile = false;
		target = this.militaryObjects.creeps;
		allies = this.militaryObjects.myCreeps;
	}

	if (structure.structureType == STRUCTURE_TOWER) {
		for (var i in allies) {
			var pos = allies[i].pos;
			var power = structure.getPowerAtRange(structure.pos.getRangeTo(pos));
			this.addMilitaryAssertion(pos.x, pos.y, power * TOWER_POWER_HEAL, hostile && 'healing' || 'myHealing');
		}

		for (var i in targets) {
			var pos = targets[i].pos;
			var power = structure.getPowerAtRange(structure.pos.getRangeTo(pos));
			this.addMilitaryAssertion(pos.x, pos.y, power * TOWER_POWER_ATTACK, hostile && 'damage' || 'myDamage');
		}

		// @todo Factor repair power.
	}
};

Room.prototype.addMilitaryAssertion = function (x, y, amount, type) {
	if (x < 0 || x > 49 || y < 0 || y > 49 || amount <= 0) return;

	if (!this.sitRep[type][x]) {
		this.sitRep[type][x] = {};
	}
	this.sitRep[type][x][y] = (this.sitRep[type][x][y] || 0) + amount;
};

Room.prototype.getMilitaryAssertion = function (x, y, type) {
	if (this.sitRep[type] && this.sitRep[type][x] && this.sitRep[type][x][y]) {
		return this.sitRep[type][x][y];
	}

	return 0;
};

Room.prototype.assertTargetPriorities = function () {
	// @todo Use target's value / potential damage.
	for (var i in this.militaryObjects.creeps) {
		var creep = this.militaryObjects.creeps[i];
		var potentialDamage = this.getMilitaryAssertion(creep.pos.x, creep.pos.y, 'myDamage');
		var potentialHealing = this.getMilitaryAssertion(creep.pos.x, creep.pos.y, 'healing');

		// @todo Potential damage will have to be reduced if creep has boosted tough parts.

		if (potentialDamage > potentialHealing) {
			creep.militaryPriority = creep.getMilitaryValue() / (potentialDamage - potentialHealing);
		}
	}
};

Room.prototype.getTowerTarget = function(tower) {
	if (!this.militaryObjects) {
		this.assertMilitarySituation();
	}

	var max = null;
	for (var i in this.militaryObjects.creeps) {
		var creep = this.militaryObjects.creeps[i];
		//console.log(creep);

		if (creep.militaryPriority && (!max || max.militaryPriority < creep.militaryPriority)) {
			max = creep;
		}
	}

	//if (max) console.log(max);

	return max;
};

Room.prototype.drawMilitarySituation = function () {
	for (var x in this.sitRep.damage) {
		for (var y in this.sitRep.damage[x]) {
			this.visual.text(this.sitRep.damage[x][y], x * 1, y * 1 - 0.1, {
				color: 'red',
				font: 0.5,
			});
		}
	}
	for (var x in this.sitRep.healing) {
		for (var y in this.sitRep.healing[x]) {
			this.visual.text(this.sitRep.healing[x][y], x * 1, y * 1 + 0.4, {
				color: 'green',
				font: 0.5,
			});
		}
	}
	for (var x in this.sitRep.myDamage) {
		for (var y in this.sitRep.myDamage[x]) {
			this.visual.text(this.sitRep.myDamage[x][y], x * 1, y * 1 - 0.1, {
				color: 'red',
				font: 0.5,
			});
		}
	}
	for (var x in this.sitRep.myHealing) {
		for (var y in this.sitRep.myHealing[x]) {
			this.visual.text(this.sitRep.myHealing[x][y], x * 1, y * 1 + 0.4, {
				color: 'green',
				font: 0.5,
			});
		}
	}
};

// @todo Move to different file.
StructureTower.prototype.getPowerAtRange = function (range) {
	if (range < TOWER_OPTIMAL_RANGE) range = TOWER_OPTIMAL_RANGE;
	if (range > TOWER_FALLOFF_RANGE) range = TOWER_FALLOFF_RANGE;

	return 1 - ((range - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE)) * TOWER_FALLOFF;
};

var bodyPartValues = {
	move: 0,
	work: 1,
	carry: 0,
	attack: 1,
	ranged_attack: 2,
	heal: 5,
	claim: 10,
	tough: 0,
};

Creep.prototype.getMilitaryValue = function() {
	// @todo Factor boosts.

	let value = 0;

	for (var i in this.body) {
		var factor = 0.1 + 0.9 * this.body[i].hits / 100;

		value += factor * bodyPartValues[this.body[i].type] || 0;
	}

	return value;
};

module.exports = {

	init: function () {

		// @todo Add functions to Game context if necessary.

	}

};

// @todo Build small ramparts on spawns and on paths close to exit
// where enemy ranged creeps might reach.
