'use strict';

/* global hivemind Creep StructureController FIND_HOSTILE_CREEPS
STRUCTURE_CONTROLLER STRUCTURE_STORAGE STRUCTURE_SPAWN STRUCTURE_TOWER
LOOK_STRUCTURES FIND_STRUCTURES FIND_MY_CREEPS CREEP_LIFE_TIME
FIND_HOSTILE_STRUCTURES OK STRUCTURE_TERMINAL */

const utilities = require('./utilities');

/**
 * Get a priority list of military targets for this creep.
 *
 * @return {Array}
 *   An array of target options for this creep.
 */
Creep.prototype.getAvailableMilitaryTargets = function () {
	const creep = this;
	const options = [];

	if (!creep.memory.target) return options;

	const targetPosition = utilities.decodePosition(creep.memory.target);
	if (!targetPosition) {
		delete creep.memory.target;
		return options;
	}

	if (creep.pos.roomName !== targetPosition.roomName) return options;

	// Find enemies to attack.
	if (creep.memory.body.attack) {
		this.addMilitaryAttackOptions(options);
	}

	// Find friendlies to heal.
	if (creep.memory.body.heal) {
		this.addMilitaryHealOptions(options);
	}

	// Attack / Reserve controllers.
	if (creep.memory.body.claim && creep.memory.body.claim >= 5) {
		if (creep.room.controller.owner && !creep.room.controller.my) {
			options.push({
				priority: 5,
				weight: 0,
				type: 'controller',
				object: creep.room.controller,
			});
		}
	}

	if (creep.memory.body.claim && !creep.room.controller.owner) {
		options.push({
			priority: 4,
			weight: 0,
			type: 'controller',
			object: creep.room.controller,
		});
	}

	// @todo Run home for healing if no functional parts are left.

	return options;
};

/**
 * Adds attack options to military targets for this creep.
 *
 * @param {Array} options
 *   An array of target options for this creep.
 */
Creep.prototype.addMilitaryAttackOptions = function (options) {
	const enemies = this.room.find(FIND_HOSTILE_CREEPS);
	const targetPosition = utilities.decodePosition(this.memory.target);

	if (enemies && enemies.length > 0) {
		for (const enemy of enemies) {
			// Check if enemy is harmless, and ignore it.
			if (!enemy.isDangerous() && (!this.room.controller || !this.room.controller.my)) continue;

			const option = {
				priority: 5,
				weight: 1 - (this.pos.getRangeTo(enemy) / 50),
				type: 'hostilecreep',
				object: enemy,
			};

			// @todo Calculate weight / priority from distance, HP left, parts.

			options.push(option);
		}
	}

	// Find structures to attack.
	let structures = this.room.find(FIND_HOSTILE_STRUCTURES, {
		filter: structure => structure.structureType !== STRUCTURE_CONTROLLER && structure.structureType !== STRUCTURE_STORAGE && structure.hits,
	});
	if (!this.room.controller || !this.room.controller.owner || hivemind.relations.isAlly(this.room.controller.owner.username)) structures = [];

	// Attack structures under target flag (even if non-hostile, like walls).
	const directStructures = targetPosition.lookFor(LOOK_STRUCTURES);
	for (const structure of directStructures || []) {
		structures.push(structure);
	}

	for (const structure of structures) {
		const option = {
			priority: 2,
			weight: 0,
			type: 'hostilestructure',
			object: structure,
		};

		// @todo Calculate weight / priority from distance, HP left, parts.
		if (structure.structureType === STRUCTURE_SPAWN) {
			option.priority = 4;
		}

		if (structure.structureType === STRUCTURE_TOWER) {
			option.priority = 3;
		}

		options.push(option);
	}

	// Find walls in front of controller.
	if (this.room.controller && this.room.controller.owner && !this.room.controller.my) {
		const structures = this.room.controller.pos.findInRange(FIND_STRUCTURES, 1, {
			filter: structure => structure.structureType !== STRUCTURE_CONTROLLER,
		});

		for (const structure of structures) {
			const option = {
				priority: 0,
				weight: 0,
				type: 'hostilestructure',
				object: structure,
			};

			options.push(option);
		}
	}
};

/**
 * Adds heal options to military targets for this creep.
 *
 * @param {Array} options
 *   An array of target options for this creep.
 */
Creep.prototype.addMilitaryHealOptions = function (options) {
	let damaged = this.room.find(FIND_MY_CREEPS, {
		filter: friendly => ((friendly.id !== this.id) && (friendly.hits < friendly.hitsMax)),
	});
	if (_.size(damaged) === 0) {
		damaged = this.room.find(FIND_HOSTILE_CREEPS, {
			filter: friendly => ((friendly.id !== this.id) && (friendly.hits < friendly.hitsMax) && hivemind.relations.isAlly(friendly.owner.username)),
		});
	}

	for (const friendly of damaged) {
		const option = {
			priority: 3,
			weight: 0,
			type: 'creep',
			object: friendly,
		};

		// @todo Calculate weight / priority from distance, HP left, parts.

		options.push(option);
	}
};

/**
 * Sets a good military target for this creep.
 */
Creep.prototype.calculateMilitaryTarget = function () {
	const creep = this;
	const best = utilities.getBestOption(creep.getAvailableMilitaryTargets());

	if (best) {
		let action = 'heal';
		if (best.type === 'hostilecreep' || best.type === 'hostilestructure') {
			action = 'attack';
		}
		else if (best.type === 'controller') {
			action = 'claim';
		}

		creep.memory.order = {
			type: action,
			target: best.object.id,
		};
	}
	else {
		delete creep.memory.order;
	}
};

/**
 * Potentially modifies a creep when target room has been reached.
 */
Creep.prototype.militaryRoomReached = function () {
	if (this.memory.squadUnitType === 'builder') {
		// Rebrand as remote builder to work in this room from now on.
		this.memory.role = 'builder.remote';
		this.memory.target = utilities.encodePosition(this.pos);
		this.memory.singleRoom = this.pos.roomName;
	}
};

/**
 * Makes a creep move towards its designated target.
 */
Creep.prototype.performMilitaryMove = function () {
	if (this.memory.fillWithEnergy) {
		if (_.sum(this.carry) < this.carryCapacity) {
			this.performGetEnergy();
			return;
		}

		delete this.memory.fillWithEnergy;
	}

	if (this.memory.pathName) {
		this.followFlagPath(this.memory.pathName);
		return;
	}

	if (this.memory.exploitName) {
		this.performExploitMove();
		return;
	}

	if (this.memory.squadName) {
		this.performSquadMove();
	}

	if (this.memory.target) {
		const targetPosition = utilities.decodePosition(this.memory.target);
		if (this.pos.roomName !== targetPosition.roomName) {
			if (!this.moveToRoom(targetPosition.roomName)) {
				hivemind.log('creeps').debug(this.name, 'can\'t move from', this.pos.roomName, 'to', targetPosition.roomName);
				// @todo This is cross-room movement and should therefore only calculate a path once.
				this.moveToRange(targetPosition, 3);
			}

			return;
		}

		this.moveTo(targetPosition);
	}

	if (this.memory.order) {
		const target = Game.getObjectById(this.memory.order.target);

		if (target) {
			if (this.memory.body.attack) {
				const ignore = (!this.room.controller || !this.room.controller.owner || (!this.room.controller.my && !hivemind.relations.isAlly(this.room.controller.owner.username)));
				this.moveTo(target, {
					reusePath: 5,
					ignoreDestructibleStructures: ignore,
				});
			}
			else {
				this.goTo(target, {
					range: 1,
					maxRooms: 1,
				});
			}
		}

		return;
	}

	if (this.memory.squadName) {
		const attackFlags = _.filter(Game.flags, flag => flag.name === 'AttackSquad:' + this.memory.squadName);
		if (attackFlags.length > 0) {
			this.moveTo(attackFlags[0]);

			if (this.pos.roomName === attackFlags[0].pos.roomName) {
				this.militaryRoomReached();
			}
			else {
				this.memory.target = utilities.encodePosition(attackFlags[0].pos);
			}

			return;
		}
	}

	this.moveTo(25, 25, {
		reusePath: 50,
	});
};

/**
 * Follows a set of flags to a creep's target.
 */
Creep.prototype.followFlagPath = function () {
	// @todo Decide if squad should be fully spawned / have an order or attack flag before moving along path.
	const flagName = 'Path:' + this.memory.pathName + ':' + this.memory.pathStep;
	const flag = Game.flags[flagName];

	if (flag) {
		this.moveTo(flag);
		if (this.pos.getRangeTo(flag) < 5) {
			console.log(this.name, 'reached waypoint', this.memory.pathStep, 'of path', this.memory.pathName, 'and has', this.ticksToLive, 'ticks left to live.');

			this.memory.pathStep++;
		}

		return;
	}

	console.log(this.name, 'reached end of path', this.memory.pathName, 'at step', this.memory.pathStep, 'and has', this.ticksToLive, 'ticks left to live.');

	delete this.memory.pathName;
	delete this.memory.pathStep;

	this.militaryRoomReached();
};

/**
 * Performs creep movement as part of an exploit operation.
 */
Creep.prototype.performExploitMove = function () {
	const exploit = Game.exploits[this.memory.exploitName];
	if (!exploit) return;

	// If an enemy is close by, move to attack it.
	const enemies = this.pos.findInRange(FIND_HOSTILE_CREEPS, 10, {
		filter: enemy => enemy.isDangerous(),
	});
	if (enemies.length > 0) {
		this.memory.exploitTarget = enemies[0].id;
	}

	if (this.memory.exploitTarget) {
		const target = Game.getObjectById(this.memory.exploitTarget);

		if (target) {
			this.moveTo(target);
			return;
		}

		delete this.memory.exploitTarget;
	}

	// Clear cached path if we've gotton close to goal.
	if (this.memory.patrolPoint && this.hasCachedPath()) {
		const lair = Game.getObjectById(this.memory.patrolPoint);
		if (this.pos.getRangeTo(lair) <= 7) {
			this.clearCachedPath();
		}
	}

	// Follow cached path when requested.
	if (this.hasCachedPath()) {
		this.followCachedPath();
		if (this.hasArrived()) {
			this.clearCachedPath();
		}
		else {
			return;
		}
	}

	if (this.pos.roomName !== exploit.roomName && !this.hasCachedPath() && exploit.memory.pathToRoom) {
		// Follow cached path to target room.
		this.setCachedPath(exploit.memory.pathToRoom);
		return;
	}

	// In-room movement.
	this.performExploitPatrol();
};

/**
 * Makes exploit creeps patrol along source keeper lairs.
 */
Creep.prototype.performExploitPatrol = function () {
	const exploit = Game.exploits[this.memory.exploitName];

	// Start at closest patrol point to entrance
	if (!this.memory.patrolPoint) {
		if (exploit.memory.closestLairToEntrance) {
			this.memory.patrolPoint = exploit.memory.closestLairToEntrance;
		}
		else if (exploit.memory.lairs) {
			this.memory.patrolPoint = _.sample(_.keys(exploit.memory.lairs));
		}
	}

	if (this.memory.patrolPoint) return;

	this.memory.target = this.memory.patrolPoint;
	const lair = Game.getObjectById(this.memory.patrolPoint);
	if (!lair) return;

	// Seems we have arrived at a patrol Point, and no enemies are immediately nearby.
	// Find patrol point where we'll have the soonest fight.
	let best = null;
	let bestTime = null;

	const id = this.memory.patrolPoint;
	for (const id2 of _.keys(exploit.memory.lairs)) {
		const otherLair = Game.getObjectById(id2);
		if (!otherLair) continue;

		let time = otherLair.ticksToSpawn || 0;

		if (id !== id2) {
			if (exploit.memory.lairs[id].paths[id2].path) {
				time = Math.max(time, exploit.memory.lairs[id].paths[id2].path.length);
			}
			else {
				time = Math.max(time, exploit.memory.lairs[id2].paths[id].path.length);
			}
		}

		if (!best || time < bestTime) {
			best = id2;
			bestTime = time;
		}
	}

	if (!best) return;

	if (best === this.memory.patrolPoint) {
		// We're at the correct control point. Move to intercept potentially spawning source keepers.
		if (exploit.memory.lairs[best].sourcePath) {
			this.moveTo(utilities.decodePosition(exploit.memory.lairs[best].sourcePath.path[1]));
		}
		else {
			this.moveToRange(lair, 1);
		}
	}
	else {
		this.memory.patrolPoint = best;
		if (exploit.memory.lairs[id].paths[best].path) {
			this.setCachedPath(exploit.memory.lairs[id].paths[best].path, false, 3);
		}
		else {
			this.setCachedPath(exploit.memory.lairs[best].paths[id].path, true, 3);
		}
	}
};

/**
 * Makes a creep move as part of a squad.
 */
Creep.prototype.performSquadMove = function () {
	// Check if there are orders and set a target accordingly.
	const squad = Game.squads[this.memory.squadName];
	if (!squad) return; // @todo Go recycle.

	// Movement is dictated by squad orders.
	const orders = squad.getOrders();
	if (orders.length > 0) {
		this.memory.target = orders[0].target;
	}
	else {
		delete this.memory.target;
	}

	if (this.memory.target) return;

	// If no order has been given, wait by spawn and renew.
	const spawnFlags = _.filter(Game.flags, flag => flag.name === 'SpawnSquad:' + this.memory.squadName);
	if (spawnFlags.length === 0) return;

	const flag = spawnFlags[0];
	if (this.pos.roomName !== flag.pos.roomName) return;

	// Refresh creep if it's getting low, so that it has high lifetime when a mission finally starts.
	if (this.ticksToLive < CREEP_LIFE_TIME * 0.66) {
		const spawn = this.pos.findClosestByRange(FIND_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_SPAWN,
		});

		if (spawn) {
			if (spawn.renewCreep(this) !== OK) {
				this.moveTo(spawn);
			}

			return;
		}
	}

	// If there's nothing to do, move back to spawn flag.
	this.moveTo(flag);
};

/**
 * Makes a creep try to attack its designated target or nearby enemies.
 *
 * @return {boolean}
 *   True if an attack was made.
 */
Creep.prototype.performMilitaryAttack = function () {
	const creep = this;
	if (!creep.memory.order) return;

	const target = Game.getObjectById(creep.memory.order.target);

	if (target && !target.my && this.attackMilitaryTarget(target)) return true;

	// See if enemies are nearby, attack one of those.
	const hostiles = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 1);
	for (const hostile of hostiles) {
		// Check if enemy is harmless, and ignore it.
		if (!hostile.isDangerous()) continue;
		if (hostile.owner && hivemind.relations.isAlly(hostile.owner.username)) continue;

		if (creep.attack(hostile) === OK) {
			return true;
		}
	}

	// Don't attack structures in allied rooms.
	if (creep.room.controller && creep.room.controller.owner && hivemind.relations.isAlly(creep.room.controller.owner.username)) return false;

	// See if enemy structures are nearby, attack one of those.
	const structures = creep.pos.findInRange(FIND_HOSTILE_STRUCTURES, 1, {
		filter: structure => structure.structureType !== STRUCTURE_CONTROLLER && structure.structureType !== STRUCTURE_STORAGE && structure.structureType !== STRUCTURE_TERMINAL,
	});
	// Find target with lowest HP to kill off (usually relevant while trying to break through walls).
	let lowestStructure;
	for (const structure of structures) {
		if (structure.hits && (!lowestStructure || structure.hits < lowestStructure.hits)) {
			lowestStructure = structure;
		}
	}

	if (creep.attack(lowestStructure) === OK) {
		return true;
	}

	return false;
};

/**
 * Makes a creep try to attack its designated target.
 *
 * @param {RoomObject} target
 *   Target to try and attack.
 *
 * @return {boolean}
 *   True if an attack was made.
 */
Creep.prototype.attackMilitaryTarget = function (target) {
	if (target instanceof StructureController) {
		if (target.owner) {
			if (this.attackController(target) === OK) {
				return true;
			}
		}

		// If attack flag is directly on controller, claim it, otherwise just reserve.
		if (this.memory.squadName && Game.flags['AttackSquad:' + this.memory.squadName] && Game.flags['AttackSquad:' + this.memory.squadName].pos.getRangeTo(target) === 0) {
			if (this.claimController(target) === OK) {
				return true;
			}
		}
		else if (this.reserveController(target) === OK) {
			return true;
		}
	}
	else if (!target.owner || !hivemind.relations.isAlly(target.owner.username)) {
		if (this.attack(target) === OK) {
			return true;
		}
	}
};

/**
 * Makes a creep heal itself or nearby injured creeps.
 *
 * @return {boolean}
 *   True if an action was ordered.
 */
Creep.prototype.performMilitaryHeal = function () {
	const creep = this;
	if (creep.memory.order) {
		const target = Game.getObjectById(creep.memory.order.target);

		if (target && (target.my || (target.owner && hivemind.relations.isAlly(target.owner.username)))) {
			if (creep.heal(target) === OK) {
				return true;
			}
		}
	}

	// See if damaged creeps are adjacent, heal those.
	const nearbyDamaged = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
		filter: creep => creep.hits < creep.hitsMax,
	});
	if (_.size(nearbyDamaged) > 0) {
		if (creep.heal(nearbyDamaged[0]) === OK) {
			return true;
		}
	}

	// Heal self.
	if (creep.hits < creep.hitsMax) {
		if (creep.heal(creep) === OK) {
			return true;
		}
	}

	// See if damaged creeps are in range, heal those.
	const rangedDamaged = creep.pos.findInRange(FIND_MY_CREEPS, 3, {
		filter: creep => creep.hits < creep.hitsMax,
	});
	if (_.size(rangedDamaged) > 0) {
		if (creep.rangedHeal(rangedDamaged[0]) === OK) {
			return true;
		}
	}

	return false;
};

/**
 * Initializes memory of military creeps.
 */
Creep.prototype.initBrawlerState = function () {
	this.memory.initialized = true;

	if (this.memory.squadName) {
		const squad = Game.squads[this.memory.squadName];
		if (squad && squad.memory.pathName) {
			this.memory.pathName = squad.memory.pathName;
			this.memory.pathStep = 1;
		}
	}

	if (this.memory.squadUnitType === 'builder') {
		this.memory.fillWithEnergy = true;
	}

	if (this.memory.pathTarget) {
		if (this.room.memory.remoteHarvesting && this.room.memory.remoteHarvesting[this.memory.pathTarget] && this.room.memory.remoteHarvesting[this.memory.pathTarget].cachedPath) {
			this.setCachedPath(this.room.memory.remoteHarvesting[this.memory.pathTarget].cachedPath.path);
		}
	}
};

/**
 * Makes a creep behave like a brawler.
 */
Creep.prototype.runBrawlerLogic = function () {
	if (!this.memory.initialized) {
		this.initBrawlerState();
	}

	// Target is recalculated every turn for best results.
	this.calculateMilitaryTarget();

	this.performMilitaryMove();

	if (!this.performMilitaryAttack()) {
		this.performMilitaryHeal();
	}
};
