var utilities = require('utilities');

var Squad = function(squadName) {
	this.name = squadName;
	this.units = {};

	if (!Memory.squads) {
		Memory.squads = {};
	}

	if (!Memory.squads[squadName]) {
		Memory.squads[squadName] = {
			composition: {},
			fullySpawned: false,
		};
	}

	let spawnFlag = Game.flags['SpawnSquad:' + squadName];
	if (spawnFlag && spawnFlag.color != COLOR_GREEN) {
		spawnFlag.setColor(COLOR_GREEN);
	}

	let attackFlag = Game.flags['AttackSquad:' + squadName];
	if (attackFlag && attackFlag.color != COLOR_RED) {
		attackFlag.setColor(COLOR_RED);
	}

	this.memory = Memory.squads[squadName];
};

/**
 * Adds one unit of a certain type to the squad's composition.
 */
Squad.prototype.addUnit = function (unitType) {
	if (!this.memory.composition[unitType]) {
		this.memory.composition[unitType] = 0;
	}
	this.memory.composition[unitType]++;

	return this.memory.composition[unitType];
};

/**
 * Removes one unit of a certain type from the squad's composition.
 */
Squad.prototype.removeUnit = function (unitType) {
	if (!this.memory.composition[unitType]) {
		return;
	}
	this.memory.composition[unitType]--;

	return this.memory.composition[unitType];
};

/**
 * Set the number of requested units of a certain type.
 */
Squad.prototype.setUnitCount = function (unitType, count) {
	this.memory.composition[unitType] = count;
};

/**
 * Clears registered units for this squad.
 */
Squad.prototype.clearUnits = function () {
	this.memory.composition = {};
};

/**
 * Decides whether this squad needs additional units spawned.
 */
Squad.prototype.needsSpawning = function () {
	for (var unitType in this.memory.composition) {
		if (this.memory.composition[unitType] > _.size(this.units[unitType])) {
			return unitType;
		}
	}

	this.memory.fullySpawned = true;
	return null;
};

/**
 * Spawns another unit for this squad.
 */
Squad.prototype.spawnUnit = function (spawn) {
	var toSpawn = this.needsSpawning();

	if (!toSpawn) return false;

	if (toSpawn == 'ranger') {
		spawn.createManagedCreep({
			role: 'brawler',
			bodyWeights: {move: 0.5, ranged_attack: 0.3, heal: 0.2},
			memory: {
				squadName: this.name,
				squadUnitType: toSpawn,
			},
		});
	}
	else if (toSpawn == 'healer') {
		var boosts = null;
		if (spawn.room.canSpawnBoostedCreeps()) {
			var availableBoosts = spawn.room.getAvailableBoosts('heal');
			var bestBoost;
			for (let resourceType in availableBoosts || []) {
				if (availableBoosts[resourceType].available >= 50) {
					if (!bestBoost || availableBoosts[resourceType].effect > availableBoosts[bestBoost].effect) {
						bestBoost = resourceType;
					}
				}
			}

			if (bestBoost) {
				boosts = {
					heal: bestBoost,
				};
			}
		}

		spawn.createManagedCreep({
			role: 'brawler',
			bodyWeights: {move: 0.52, heal: 0.48},
			boosts: boosts,
			memory: {
				squadName: this.name,
				squadUnitType: toSpawn,
			},
		});
	}
	else if (toSpawn == 'claimer') {
		spawn.createManagedCreep({
			role: 'brawler',
			bodyWeights: {move: 0.52, tough: 0.18, claim: 0.3},
			memory: {
				squadName: this.name,
				squadUnitType: toSpawn,
			},
		});
	}
	else if (toSpawn == 'singleClaim') {
		spawn.createManagedCreep({
			role: 'brawler',
			body: [MOVE, MOVE, MOVE, MOVE, MOVE, CLAIM],
			memory: {
				squadName: this.name,
				squadUnitType: toSpawn,
			},
		});
	}
	else if (toSpawn == 'builder') {
		spawn.createManagedCreep({
			role: 'brawler',
			bodyWeights: {move: 0.52, carry: 0.38, work: 0.1},
			memory: {
				squadName: this.name,
				squadUnitType: toSpawn,
			},
		});
	}
	else if (toSpawn == 'attacker') {
		var boosts = null;
		if (spawn.room.canSpawnBoostedCreeps()) {
			var availableBoosts = spawn.room.getAvailableBoosts('attack');
			var bestBoost;
			for (let resourceType in availableBoosts || []) {
				if (availableBoosts[resourceType].available >= 50) {
					if (!bestBoost || availableBoosts[resourceType].effect > availableBoosts[bestBoost].effect) {
						bestBoost = resourceType;
					}
				}
			}

			if (bestBoost) {
				boosts = {
					attack: bestBoost,
				};
			}
		}

		spawn.createManagedCreep({
			role: 'brawler',
			bodyWeights: {move: 0.5, attack: 0.5},
			memory: {
				squadName: this.name,
				squadUnitType: toSpawn,
			},
		});
	}
	else if (toSpawn == 'test') {
		spawn.createManagedCreep({
			role: 'brawler',
			body: [MOVE],
			memory: {
				squadName: this.name,
				squadUnitType: toSpawn,
			},
		});
	}
	else {
		spawn.createManagedCreep({
			role: 'brawler',
			bodyWeights: {move: 0.5, attack: 0.3, heal: 0.2},
			memory: {
				squadName: this.name,
				squadUnitType: toSpawn,
			},
		});
	}

	return true;
};

Squad.prototype.getOrders = function () {
	var options = [];

	if (this.memory.fullySpawned) {
		// Check if there is an attack flag for this squad.
		var attackFlags = _.filter(Game.flags, (flag) => flag.name == 'AttackSquad:' + this.name);
		if (attackFlags.length > 0) {
			options.push({
				priority: 5,
				weight: 0,
				target: utilities.encodePosition(attackFlags[0].pos),
			});
		}
	}

	return options;
};

/**
 * Sets a waypoint path for all units of this squad to follow after spawning.
 */
Squad.prototype.setPath = function (pathName) {
	this.memory.pathName = pathName;

	// @todo If there are creeps already spawned, send them on the path.
};

/**
 * Orders squad to spawn in the given room.
 */
Squad.prototype.setSpawn = function (roomName) {
	let key = 'SpawnSquad:' + this.name;
	let spawnPos = new RoomPosition(25, 25, roomName);
	if (Game.flags[key]) {
		Game.flags[key].setPosition(spawnPos);
	}
	else {
		spawnPos.createFlag(key);
	}
};

/**
 * Orders squad to move toward the given position.
 */
Squad.prototype.setTarget = function (targetPos) {
	let key = 'AttackSquad:' + this.name;
	if (Game.flags[key]) {
		Game.flags[key].setPosition(targetPos);
	}
	else {
		targetPos.createFlag(key);
	}
};

module.exports = Squad;
