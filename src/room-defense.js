'use strict';

/* global LOOK_STRUCTURES STRUCTURE_RAMPART ATTACK HEAL CLAIM */

const maxVisitorsPerUser = 5;

const RoomDefense = function (roomName) {
	this.roomName = roomName;
	this.room = Game.rooms[roomName];

	if (!this.room.memory.defense) this.room.memory.defense = {};

	this.memory = this.room.memory.defense;
};

/**
 * Checks if a room's walls are intact.
 *
 * @return {boolean}
 *   True if all planned ramparts are built and strong enough.
 */
RoomDefense.prototype.isWallIntact = function () {
	const rampartPositions = this.room.roomPlanner.getLocations('rampart');
	const requiredHits = 25000 * this.room.controller.level * this.room.controller.level;

	for (const pos of rampartPositions) {
		// Check if there's a rampart here already.
		const structures = pos.lookFor(LOOK_STRUCTURES);
		if (_.filter(structures, structure => structure.structureType === STRUCTURE_RAMPART && structure.hits >= requiredHits).length === 0) {
			return false;
		}
	}

	return true;
};

/**
 * Determines enemy strength in a room.
 *
 * @return {Number}
 *   0: No enemies in the room.
 *   1: Enemies are very weak, towers can take them out.
 *   2: Enemies are strong or numerous.
 */
RoomDefense.prototype.getEnemyStrength = function () {
	let attackStrength = 0;
	let boosts = 0;

	_.each(this.room.enemyCreeps, creeps => {
		for (const creep of creeps) {
			for (const part of creep.body) {
				if (part.type === ATTACK || part.type === HEAL || part.type === CLAIM) {
					attackStrength++;
					if (part.boost) {
						boosts += part.boost.length;
					}

					continue;
				}
			}
		}
	});

	if (attackStrength === 0) return 0;
	if (boosts + attackStrength < 30) return 1;
	return 2;
};

RoomDefense.prototype.openRampartsToFriendlies = function () {
	// @todo Detect stealing creeps!

	if (_.size(this.room.enemyCreeps) === 0) {
		if (this.memory.lastActivity && Game.time - this.memory.lastActivity > 10) {
			// Close ramparts after last friendly leaves the room for a while.
			const ramparts = this.room.find(FIND_STRUCTURES, {filter: structure => structure.structureType === STRUCTURE_RAMPART});
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
		const numInRoom = _.size(_.filter(creeps, creep => this.isInRoom(creep)));

		for (const creep of creeps) {
			this.recordCreepStatus(creep);

			if (!this.isWhitelisted(username) || !this.isUnarmedCreep(creep)) {
				// Deny unwanted creeps.
				forbidden.push(creep);
				continue;
			}

			if (numInRoom >= maxVisitorsPerUser && !this.isInRoom(creep)) {
				// Extra creeps outside are denied entry.
				forbidden.push(creep);
				continue;
			}

			allowed.push(creep);
		}
	});

	const ramparts = this.room.find(FIND_STRUCTURES, {filter: structure => structure.structureType === STRUCTURE_RAMPART});
	_.each(ramparts, rampart => {
		const newState = this.calculateRampartState(rampart, allowed, forbidden);
		if (rampart.isPublic !== newState) rampart.setPublic(newState);
	});
};

RoomDefense.prototype.recordCreepStatus = function (creep) {
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
	_.each(creep.store, (amount, resourceType) => {
		if (amount > memory.store[resourceType] || 0) {
			memory.isThief = true;
		}
		memory.store[resourceType] = amount;
	});
	_.each(memory.store, (amount, resourceType) => {
		if (!creep.store[resourceType]) delete memory.store[resourceType];
	})
}

RoomDefense.prototype.isThief = function (creep) {
	if (!this.memory.creepStatus) return false;
	if (!this.memory.creepStatus[creep.id]) return false;
	if (!this.memory.creepStatus[creep.id].isThief) return false;

	return true;
}

RoomDefense.prototype.calculateRampartState = function (rampart, allowed, forbidden) {
	if (allowed.length === 0) return false;
	if (forbidden.length === 0) return true;

	for (const creep of forbidden) {
		if (creep.pos.getRangeTo(rampart) <= 3) return false;
	}

	return true;
};

RoomDefense.prototype.isUnarmedCreep = function (creep) {
	for (const part of this.body) {
		if (part.type !== MOVE && part.type !== TOUGH && part.type !== CARRY) {
			return false;
		}
	}

	return true;
};

RoomDefense.prototype.isInRoom = function (creep) {
	return creep.pos.x > 1 && creep.pos.y > 1 && creep.pos.x < 48 && creep.pos.y < 48;
}

RoomDefense.prototype.isWhitelisted = function (username) {
	return _.includes([
		'Eiskalt',
		'Fiskmans',
		'Meridion',
		'rysade',
		'SirFrump',
		'slowmotionghost',
	], username);
}

module.exports = RoomDefense;
