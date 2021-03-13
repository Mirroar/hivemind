'use strict';

/* global hivemind StructureController FIND_HOSTILE_CREEPS
STRUCTURE_CONTROLLER STRUCTURE_STORAGE STRUCTURE_SPAWN STRUCTURE_TOWER
LOOK_STRUCTURES FIND_STRUCTURES FIND_MY_CREEPS CREEP_LIFE_TIME
FIND_HOSTILE_STRUCTURES OK STRUCTURE_TERMINAL STRUCTURE_INVADER_CORE */

const utilities = require('./utilities');
const Role = require('./role');
const TransporterRole = require('./role.transporter');

const BrawlerRole = function () {
	Role.call(this);

	// Military creeps are always fully active!
	this.stopAt = 0;
	this.throttleAt = 0;

	this.transporterRole = new TransporterRole();
};

BrawlerRole.prototype = Object.create(Role.prototype);

/**
 * Makes a creep behave like a brawler.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
BrawlerRole.prototype.run = function (creep) {
	if (!creep.memory.initialized) {
		this.initBrawlerState(creep);
	}

	// Target is recalculated every turn for best results.
	this.calculateMilitaryTarget(creep);

	this.performMilitaryMove(creep);

	if (!this.performMilitaryAttack(creep)) {
		this.performMilitaryHeal(creep);
	}
};

/**
 * Initializes memory of military creeps.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
BrawlerRole.prototype.initBrawlerState = function (creep) {
	creep.memory.initialized = true;

	if (creep.memory.squadUnitType === 'builder') {
		creep.memory.fillWithEnergy = true;
	}

	if (creep.memory.pathTarget) {
		// Reuse remote harvesting path.
		const harvestMemory = creep.room.memory.remoteHarvesting;
		const pathTarget = creep.memory.pathTarget;
		if (harvestMemory && harvestMemory[pathTarget] && harvestMemory[pathTarget].cachedPath) {
			creep.setCachedPath(harvestMemory[pathTarget].cachedPath.path);
		}
	}
};

/**
 * Sets a good military target for this creep.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
BrawlerRole.prototype.calculateMilitaryTarget = function (creep) {
	const best = utilities.getBestOption(this.getAvailableMilitaryTargets(creep));

	if (!best) {
		delete creep.memory.order;
		return;
	}

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
};

/**
 * Get a priority list of military targets for this creep.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 *
 * @return {Array}
 *   An array of target options for this creep.
 */
BrawlerRole.prototype.getAvailableMilitaryTargets = function (creep) {
	const options = [];

	if (!creep.memory.target) return options;

	const targetPosition = utilities.decodePosition(creep.memory.target);
	if (!targetPosition) {
		delete creep.memory.target;
		return options;
	}

	// @todo Defend ourselves even when not in target room.
	if (creep.pos.roomName !== targetPosition.roomName) return options;

	// Find enemies to attack.
	if (creep.memory.body.attack) {
		this.addMilitaryAttackOptions(creep, options);
	}

	// Find friendlies to heal.
	if (creep.memory.body.heal) {
		this.addMilitaryHealOptions(creep, options);
	}

	// Attack / Reserve controllers.
	if (creep.memory.body.claim && creep.memory.body.claim >= 5) {
		if (creep.room.controller && !creep.room.controller.my && creep.room.controller.owner) {
			options.push({
				priority: 5,
				weight: 0,
				type: 'controller',
				object: creep.room.controller,
			});
		}
	}

	if (creep.memory.body.claim && creep.room.controller && !creep.room.controller.owner) {
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
 * @param {Creep} creep
 *   The creep to run logic for.
 * @param {Array} options
 *   An array of target options for this creep.
 */
BrawlerRole.prototype.addMilitaryAttackOptions = function (creep, options) {
	const enemies = creep.room.find(FIND_HOSTILE_CREEPS);
	const targetPosition = utilities.decodePosition(creep.memory.target);

	if (enemies && enemies.length > 0) {
		for (const enemy of enemies) {
			// Check if enemy is harmless, and ignore it outside own rooms.
			if (!enemy.isDangerous() && !creep.room.isMine()) continue;

			const option = {
				priority: 5,
				weight: 1 - (creep.pos.getRangeTo(enemy) / 50),
				type: 'hostilecreep',
				object: enemy,
			};

			// @todo Calculate weight / priority from distance, HP left, parts.

			options.push(option);
		}
	}

	// Find structures to attack.
	let structures = creep.room.find(FIND_HOSTILE_STRUCTURES, {
		filter: structure => structure.structureType !== STRUCTURE_CONTROLLER && structure.structureType !== STRUCTURE_STORAGE && structure.hits,
	});
	if (!creep.room.controller || !creep.room.controller.owner || hivemind.relations.isAlly(creep.room.controller.owner.username)) {
		// Outside of owned rooms, only attack invader cores.
		structures = _.filter(structures, structure => structure.structureType === STRUCTURE_INVADER_CORE);
	}

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
	if (creep.room.controller && creep.room.controller.owner && !creep.room.controller.my) {
		const structures = creep.room.controller.pos.findInRange(FIND_STRUCTURES, 1, {
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
 * @param {Creep} creep
 *   The creep to run logic for.
 * @param {Array} options
 *   An array of target options for this creep.
 */
BrawlerRole.prototype.addMilitaryHealOptions = function (creep, options) {
	let damaged = creep.room.find(FIND_MY_CREEPS, {
		filter: friendly => ((friendly.id !== creep.id) && (friendly.hits < friendly.hitsMax)),
	});
	if (_.size(damaged) === 0) {
		damaged = creep.room.find(FIND_HOSTILE_CREEPS, {
			filter: friendly => ((friendly.id !== creep.id) && (friendly.hits < friendly.hitsMax) && hivemind.relations.isAlly(friendly.owner.username)),
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
 * Makes a creep move towards its designated target.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
BrawlerRole.prototype.performMilitaryMove = function (creep) {
	if (creep.memory.fillWithEnergy) {
		if (_.sum(creep.carry) < creep.carryCapacity) {
			this.transporterRole.performGetEnergy(creep);
			return;
		}

		delete creep.memory.fillWithEnergy;
	}

	if (creep.memory.exploitName) {
		this.performExploitMove(creep);
		return;
	}

	if (creep.memory.squadName) {
		this.performSquadMove(creep);
	}

	if (creep.memory.target) {
		const targetPosition = utilities.decodePosition(creep.memory.target);
		if (creep.pos.roomName !== targetPosition.roomName) {
			if (!creep.moveToRoom(targetPosition.roomName, true)) {
				hivemind.log('creeps').debug(creep.name, 'can\'t move from', creep.pos.roomName, 'to', targetPosition.roomName);
				// @todo This is cross-room movement and should therefore only calculate a path once.
				creep.moveToRange(targetPosition, 3);
			}

			return;
		}

		// @todo For some reason, using goTo instead of moveTo here results in
		// a lot of "trying to follow non-existing path" errors moving across rooms.
		creep.moveTo(targetPosition);
	}

	if (creep.memory.order) {
		const target = Game.getObjectById(creep.memory.order.target);

		if (target) {
			if (creep.memory.body.attack) {
				const ignore = (!creep.room.controller || !creep.room.controller.owner || (!creep.room.controller.my && !hivemind.relations.isAlly(creep.room.controller.owner.username)));
				creep.moveTo(target, {
					reusePath: 5,
					ignoreDestructibleStructures: ignore,
				});
			}
			else {
				creep.goTo(target, {
					range: 1,
					maxRooms: 1,
				});
			}
		}

		return;
	}

	if (creep.memory.squadName) {
		const squad = Game.squads[creep.memory.squadName];
		const targetPos = squad && squad.getTarget();
		if (targetPos) {
			creep.moveTo(targetPos);

			if (creep.pos.roomName === targetPos.roomName) {
				this.militaryRoomReached(creep);
			}
			else {
				creep.memory.target = utilities.encodePosition(targetPos);
			}

			return;
		}
	}

	creep.moveTo(25, 25, {
		reusePath: 50,
	});
};

/**
 * Performs creep movement as part of an exploit operation.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 *
 * @todo This should probably be done by having the exploit choose targets
 * and then using normal military creep movement to get there.
 */
BrawlerRole.prototype.performExploitMove = function (creep) {
	const exploit = Game.exploits[creep.memory.exploitName];
	if (!exploit) return;

	// If an enemy is close by, move to attack it.
	const enemies = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 10, {
		filter: enemy => enemy.isDangerous(),
	});
	if (enemies.length > 0) {
		creep.memory.exploitTarget = enemies[0].id;
	}

	if (creep.memory.exploitTarget) {
		const target = Game.getObjectById(creep.memory.exploitTarget);

		if (target) {
			creep.moveTo(target);
			return;
		}

		delete creep.memory.exploitTarget;
	}

	// Clear cached path if we've gotton close to goal.
	if (creep.memory.patrolPoint && creep.hasCachedPath()) {
		const lair = Game.getObjectById(creep.memory.patrolPoint);
		if (creep.pos.getRangeTo(lair) <= 7) {
			creep.clearCachedPath();
		}
	}

	// Follow cached path when requested.
	if (creep.hasCachedPath()) {
		creep.followCachedPath();
		if (creep.hasArrived()) {
			creep.clearCachedPath();
		}
		else {
			return;
		}
	}

	if (creep.pos.roomName !== exploit.roomName && !creep.hasCachedPath() && exploit.memory.pathToRoom) {
		// Follow cached path to target room.
		creep.setCachedPath(exploit.memory.pathToRoom);
		return;
	}

	// In-room movement.
	this.performExploitPatrol(creep);
};

/**
 * Makes exploit creeps patrol along source keeper lairs.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
BrawlerRole.prototype.performExploitPatrol = function (creep) {
	const exploit = Game.exploits[creep.memory.exploitName];

	// Start at closest patrol point to entrance
	if (!creep.memory.patrolPoint) {
		if (exploit.memory.closestLairToEntrance) {
			creep.memory.patrolPoint = exploit.memory.closestLairToEntrance;
		}
		else if (exploit.memory.lairs) {
			creep.memory.patrolPoint = _.sample(_.keys(exploit.memory.lairs));
		}
	}

	if (creep.memory.patrolPoint) return;

	creep.memory.target = creep.memory.patrolPoint;
	const lair = Game.getObjectById(creep.memory.patrolPoint);
	if (!lair) return;

	// Seems we have arrived at a patrol Point, and no enemies are immediately nearby.
	// Find patrol point where we'll have the soonest fight.
	let best = null;
	let bestTime = null;

	const id = creep.memory.patrolPoint;
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

	if (best === creep.memory.patrolPoint) {
		// We're at the correct control point. Move to intercept potentially spawning source keepers.
		if (exploit.memory.lairs[best].sourcePath) {
			creep.moveTo(utilities.decodePosition(exploit.memory.lairs[best].sourcePath.path[1]));
		}
		else {
			creep.moveToRange(lair, 1);
		}
	}
	else {
		creep.memory.patrolPoint = best;
		if (exploit.memory.lairs[id].paths[best].path) {
			creep.setCachedPath(exploit.memory.lairs[id].paths[best].path, false, 3);
		}
		else {
			creep.setCachedPath(exploit.memory.lairs[best].paths[id].path, true, 3);
		}
	}
};

/**
 * Makes a creep move as part of a squad.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
BrawlerRole.prototype.performSquadMove = function (creep) {
	// Check if there are orders and set a target accordingly.
	const squad = Game.squads[creep.memory.squadName];
	if (!squad) return; // @todo Go recycle.

	// Movement is dictated by squad orders.
	const orders = squad.getOrders();
	if (orders.length > 0) {
		creep.memory.target = orders[0].target;
	}
	else {
		delete creep.memory.target;
	}

	if (creep.memory.target) return;

	// If no order has been given, wait by spawn and renew.
	const spawnRoom = squad.getSpawn();
	if (!spawnRoom || creep.pos.roomName !== spawnRoom) return;

	// Refresh creep if it's getting low, so that it has high lifetime when a mission finally starts.
	if (creep.ticksToLive < CREEP_LIFE_TIME * 0.66) {
		const spawn = creep.pos.findClosestByRange(FIND_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_SPAWN,
		});

		if (spawn) {
			if (spawn.renewCreep(creep) !== OK) {
				creep.moveTo(spawn);
			}

			return;
		}
	}

	// If there's nothing to do, move back to spawn room center.
	creep.moveTo(25, 25);
};

/**
 * Potentially modifies a creep when target room has been reached.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
BrawlerRole.prototype.militaryRoomReached = function (creep) {
	if (creep.memory.squadUnitType === 'builder' && creep.room.controller) {
		// Rebrand as remote builder to work in this room from now on.
		creep.memory.role = 'builder.remote';
		creep.memory.target = utilities.encodePosition(creep.pos);
		creep.memory.singleRoom = creep.pos.roomName;
	}
};

/**
 * Makes a creep try to attack its designated target or nearby enemies.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 * @return {boolean}
 *   True if an attack was made.
 */
BrawlerRole.prototype.performMilitaryAttack = function (creep) {
	if (!creep.memory.order) return;

	const target = Game.getObjectById(creep.memory.order.target);

	if (target && !target.my && this.attackMilitaryTarget(creep, target)) return true;

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
 * @param {Creep} creep
 *   The creep to run logic for.
 * @param {RoomObject} target
 *   Target to try and attack.
 *
 * @return {boolean}
 *   True if an attack was made.
 */
BrawlerRole.prototype.attackMilitaryTarget = function (creep, target) {
	if (target instanceof StructureController) {
		if (target.owner) {
			if (creep.attackController(target) === OK) {
				return true;
			}
		}

		// If attack flag is directly on controller, claim it, otherwise just reserve.
		if (creep.memory.squadName) {
			const squad = Game.squads[creep.memory.squadName];
			const targetPos = squad && squad.getTarget();
			if (targetPos && targetPos.getRangeTo(target) === 0) {
				if (creep.claimController(target) === OK) {
					return true;
				}
			}
		}
		else if (creep.reserveController(target) === OK) {
			return true;
		}
	}
	else if (!target.owner || !hivemind.relations.isAlly(target.owner.username)) {
		if (creep.attack(target) === OK) {
			return true;
		}
	}
};

/**
 * Makes a creep heal itself or nearby injured creeps.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 * @return {boolean}
 *   True if an action was ordered.
 */
BrawlerRole.prototype.performMilitaryHeal = function (creep) {
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

module.exports = BrawlerRole;
