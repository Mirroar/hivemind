'use strict';

/* global hivemind Room BOOSTS FIND_STRUCTURES STRUCTURE_LAB LAB_BOOST_MINERAL
LAB_BOOST_ENERGY OK MOVE CARRY */

/**
 * Collects available boosts in a room, optionally filtered by effect.
 *
 * @param {string} type
 *   The effect name we want to use for boosting.
 *
 * @return {object}
 *   An object keyed by boost type (unless type was set) and then mineral type,
 *   containing information about the available boost effect and number of
 *   parts that can be boosted.
 */
Room.prototype.getAvailableBoosts = function (type) {
	if (!this.boostsCache) {
		this.fillBoostCache();
	}

	if (type) {
		return this.boostsCache[type];
	}

	return this.boostsCache;
};

/**
 * Collects information about available boosts in a room.
 */
Room.prototype.fillBoostCache = function () {
	const boosts = {};

	const storage = this.storage || {store: {}};
	const terminal = this.terminal || {store: {}};
	const resourceTypes = _.union(_.keys(storage.store), _.keys(terminal.store));

	_.each(BOOSTS, mineralBoosts => {
		for (const mineralType in mineralBoosts) {
			// Only boost using the best boosts. We'll make sure we have what we need through trading.
			if (mineralType.indexOf('X') === -1) continue;

			const boostValues = mineralBoosts[mineralType];

			if (_.indexOf(resourceTypes, mineralType) === -1) continue;

			_.each(boostValues, (boostValue, boostType) => {
				if (!boosts[boostType]) {
					boosts[boostType] = {};
				}

				boosts[boostType][mineralType] = {
					effect: boostValue,
					available: Math.floor((storage.store[mineralType] || 0 + terminal.store[mineralType] || 0) / 10),
				};
			});
		}
	});

	this.boostsCache = boosts;
};

/**
 * Decides if spawning of boosted creeps is available in this room.
 * Requires at least one unused lab.
 *
 * @return {boolean}
 *   True if the room is able to boost creeps.
 */
Room.prototype.canSpawnBoostedCreeps = function () {
	if (this.isEvacuating()) return false;

	const labs = this.getBoostLabs();

	if (labs.length > 0) {
		return true;
	}

	return false;
};

/**
 * Gets labs used for boosting creeps in this room.
 *
 * @return {Structure[]}
 *   An array of labs available for using boosts.
 */
Room.prototype.getBoostLabs = function () {
	// @todo Make room planner decide which are boost labs, or hijack
	// reaction labs when necessary.
	const boostLabs = [];
	if (!this.boostManager) return boostLabs;

	if (!this.memory.boostManager.labLastChecked || Game.time - this.memory.boostManager.labLastChecked > 1000 * hivemind.getThrottleMultiplier()) {
		this.memory.boostManager.labLastChecked = Game.time;

		const labs = this.find(FIND_STRUCTURES, {
			filter: structure => {
				if (structure.structureType !== STRUCTURE_LAB) return false;
				if (this.memory.labs && _.contains(this.memory.labs.reactor, structure.id)) return false;
				if (this.memory.labs && structure.id === this.memory.labs.source1) return false;
				if (this.memory.labs && structure.id === this.memory.labs.source2) return false;
				if (!structure.isOperational()) return false;

				return true;
			},
		});

		if (labs.length > 0) {
			if (!this.memory.boostManager.labs[labs[0].id]) {
				// Set this lab as new boost lab.
				this.memory.boostManager.labs = {};
				this.memory.boostManager.labs[labs[0].id] = {};
			}
		}
	}

	const labMemory = this.memory.boostManager.labs;
	_.each(labMemory, (data, id) => {
		const lab = Game.getObjectById(id);
		if (lab && lab.isOperational()) {
			boostLabs.push(lab);
		}
		else {
			delete labMemory[id];
		}
	});

	return boostLabs;
};

/**
 * BoostManager is responsible for choosing an applying boosts to creeps.
 * @constructor
 *
 * @param {string} roomName
 *   Name of the room this BoostManager is assigned to.
 */
const BoostManager = function (roomName) {
	this.roomName = roomName;
	this.room = Game.rooms[roomName];

	if (!Memory.rooms[roomName].boostManager) {
		Memory.rooms[roomName].boostManager = {};
	}

	this.memory = Memory.rooms[roomName].boostManager;

	if (!this.memory.creepsToBoost) {
		this.memory.creepsToBoost = {};
	}

	if (!this.memory.labs) {
		this.memory.labs = {};
	}

	// @todo Clean out this.memory.creepsToBoost of creeps that no longer exist.
};

/**
 * Prepares memory for boosting a new creep.
 *
 * @param {string} creepName
 *   Name of the creep to boost.
 * @param {string[]} boosts
 *   Array of resource types to use for boosting, indexed by body part.
 */
BoostManager.prototype.markForBoosting = function (creepName, boosts) {
	if (!boosts || !creepName) return;
	const creepMemory = Memory.creeps[creepName];

	if (!creepMemory) return;

	creepMemory.needsBoosting = true;
	const boostMemory = {};
	this.memory.creepsToBoost[creepName] = boostMemory;

	_.each(boosts, (resourceType, bodyPart) => {
		const numParts = creepMemory.body[bodyPart] || 0;

		boostMemory[resourceType] = numParts;
	});
};

/**
 * Overrides a creep's logic while it's being boosted.
 *
 * @param {Creep} creep
 *   The creep to manage.
 *
 * @return {boolean}
 *   True if we're currently overriding the creep's logic.
 */
BoostManager.prototype.overrideCreepLogic = function (creep) {
	if (!creep.memory.needsBoosting) return false;

	if (!this.memory.creepsToBoost[creep.name]) {
		delete creep.memory.needsBoosting;
		return false;
	}

	const boostMemory = this.memory.creepsToBoost[creep.name];
	if (_.size(boostMemory) === 0) {
		delete this.memory.creepsToBoost[creep.name];
		delete creep.memory.needsBoosting;
		return false;
	}

	const labMemory = this.memory.labs;
	let hasMoved = false;
	// @todo This is ugly, break up the double loop.
	_.each(boostMemory, (amount, resourceType) => {
		// Find lab to get boosted at.
		_.each(labMemory, (data, id) => {
			if (data.resourceType !== resourceType) return;

			const lab = Game.getObjectById(id);
			if (!lab) return;

			if (creep.pos.getRangeTo(lab) > 1) {
				// Get close enough to lab.
				creep.moveToRange(lab, 1);
			}
			else if (lab.mineralType === resourceType && lab.mineralAmount >= amount * LAB_BOOST_MINERAL && lab.energy >= amount * LAB_BOOST_ENERGY) {
				// If there is enough energy and resources, boost!
				if (lab.boostCreep(creep) === OK) {
					// @todo Prevent trying to boost another creep with this lab on this turn.
					// Awesome, boost has been applied (in theory).
					// Clear partial memory, to prevent trying to boost again.
					delete boostMemory[resourceType];
				}
			}

			hasMoved = true;
			return false;
		});

		if (hasMoved) return false;
	});

	return hasMoved;
};

/**
 * Gets a list of labs and their designated resource types.
 *
 * @return {object}
 *   Boosting information, keyed by lab id.
 */
BoostManager.prototype.getLabOrders = function () {
	const labs = this.room.getBoostLabs();

	if (_.size(this.memory.creepsToBoost) === 0) return {};

	const queuedBoosts = {};
	const toDelete = [];
	_.each(this.memory.creepsToBoost, (boostMemory, creepName) => {
		if (!Game.creeps[creepName]) {
			toDelete.push(creepName);
			return;
		}

		_.each(boostMemory, (amount, resourceType) => {
			queuedBoosts[resourceType] = (queuedBoosts[resourceType] || 0) + amount;
		});
	});

	for (const creepName of toDelete) {
		delete this.memory.creepsToBoost[creepName];
	}

	for (const lab of labs) {
		if (!this.memory.labs[lab.id]) {
			this.memory.labs[lab.id] = {};
		}

		if (!this.memory.labs[lab.id].resourceType || !queuedBoosts[this.memory.labs[lab.id].resourceType]) {
			const unassigned = _.filter(_.keys(queuedBoosts), resourceType => {
				return _.filter(labs, lab => this.memory.labs[lab.id].resourceType === resourceType).length === 0;
			});

			if (unassigned.length === 0) {
				delete this.memory.labs[lab.id].resourceType;
			}
			else {
				this.memory.labs[lab.id].resourceType = unassigned[0];
			}
		}

		if (this.memory.labs[lab.id].resourceType) {
			const resourceType = this.memory.labs[lab.id].resourceType;
			this.memory.labs[lab.id].resourceAmount = queuedBoosts[resourceType] * LAB_BOOST_MINERAL;
			this.memory.labs[lab.id].energyAmount = queuedBoosts[resourceType] * LAB_BOOST_ENERGY;
		}
		else {
			delete this.memory.labs[lab.id].resourceAmount;
			delete this.memory.labs[lab.id].energyAmount;
		}
	}

	// Make sure to delete memory of any labs no longer used for boosting.
	const unusedLabs = _.filter(_.keys(this.memory.labs), id => {
		return _.filter(labs, lab => lab.id === id).length === 0;
	});
	for (const id of unusedLabs) {
		delete this.memory.labs[id];
	}

	return this.memory.labs;
};

/**
 * Decides whether helper creeps need to be spawned in this room.
 *
 * @return {boolean}
 *   True if the room needs a helper creep.
 */
BoostManager.prototype.needsSpawning = function () {
	const maxHelpers = 1;
	const numHelpers = (this.room.creepsByRole.helper || []).length;

	if (numHelpers < maxHelpers) {
		// Make sure we actually need helpers.
		if (_.size(this.memory.creepsToBoost) > 0) {
			return true;
		}
	}

	return false;
};

module.exports = BoostManager;
