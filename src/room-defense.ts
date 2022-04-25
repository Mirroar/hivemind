/* global STRUCTURE_RAMPART ATTACK HEAL CLAIM MOVE TOUGH CARRY
FIND_STRUCTURES LOOK_STRUCTURES */

import hivemind from 'hivemind';
import Operation from 'operation/operation';

declare global {
	interface RoomMemory {
		defense?: any;
	}
}

// @todo Evacuate room when walls are breached, or when spawns are gone, ...
// @todo Destroy terminal and storage if not hope of recovery, then unclaim

export default class RoomDefense {
	roomName: string;
	room: Room;
	memory;

	constructor(roomName) {
		this.roomName = roomName;
		this.room = Game.rooms[roomName];

		if (!this.room.memory.defense) this.room.memory.defense = {};

		this.memory = this.room.memory.defense;
	}

	/**
	 * Checks if a room's walls are intact.
	 *
	 * @return {boolean}
	 *   True if all planned ramparts are built and strong enough.
	 */
	isWallIntact() {
		if (!this.room.roomPlanner) return true;

		const rampartPositions: RoomPosition[] = this.room.roomPlanner.getLocations('rampart');
		const requiredHits = 25_000 * this.room.controller.level * this.room.controller.level;

		for (const pos of rampartPositions) {
			// Check if there's a rampart here already.
			const structures = pos.lookFor(LOOK_STRUCTURES);
			if (_.filter(structures, structure => structure.structureType === STRUCTURE_RAMPART && structure.hits >= requiredHits).length === 0) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Determines enemy strength in a room.
	 *
	 * @return {Number}
	 *   0: No enemies in the room.
	 *   1: Enemies are very weak, towers can take them out.
	 *   2: Enemies are strong or numerous.
	 */
	getEnemyStrength() {
		let attackStrength = 0;
		let boosts = 0;

		// @todo If it's invaders, don't go up to level 2.

		_.each(this.room.enemyCreeps, creeps => {
			for (const creep of creeps) {
				for (const part of creep.body) {
					if (part.type === ATTACK || part.type === HEAL || part.type === CLAIM) {
						attackStrength++;
						if (part.boost && typeof part.boost === 'string') {
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
	}

	openRampartsToFriendlies() {
		if (_.size(this.room.enemyCreeps) === 0) {
			if (this.memory.lastActivity && Game.time - this.memory.lastActivity > 10) {
				// Close ramparts after last friendly leaves the room for a while.
				const ramparts = this.room.find<StructureRampart>(FIND_STRUCTURES, {filter: structure => structure.structureType === STRUCTURE_RAMPART});
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
			const numberInRoom = _.size(_.filter(creeps, creep => this.isInRoom(creep)));

			for (const creep of creeps) {
				this.recordCreepStatus(creep);

				if (!this.isWhitelisted(username) || (!this.isUnarmedCreep(creep) && !hivemind.relations.isAlly(username))) {
					// Deny unwanted creeps.
					forbidden.push(creep);
					continue;
				}

				if (numberInRoom >= hivemind.settings.get('maxVisitorsPerUser') && !this.isInRoom(creep)) {
					// Extra creeps outside are denied entry.
					forbidden.push(creep);
					continue;
				}

				allowed.push(creep);
			}
		});

		const ramparts = this.room.find<StructureRampart>(FIND_STRUCTURES, {filter: structure => structure.structureType === STRUCTURE_RAMPART});
		_.each(ramparts, rampart => {
			const newState = this.calculateRampartState(rampart, allowed, forbidden);
			if (rampart.isPublic !== newState) rampart.setPublic(newState);
		});
	}

	recordCreepStatus(creep) {
		// @todo Detect killed creeps as resources we've gained.

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
			if (amount !== (memory.store[resourceType] || 0)) {
				const creepGained = amount - (memory.store[resourceType] || 0);
				// We lost any resource the creep gained.
				this.calculatePlayerTrade(creep.owner.username, -creepGained, resourceType);
				// @todo Set `memory.isThief = true` when too many resources have been
				// taken.
			}

			memory.store[resourceType] = amount;
		});
		_.each(memory.store, (amount, resourceType) => {
			if (!creep.store[resourceType]) {
				// If the creep lost a resource, we gained as much.
				this.calculatePlayerTrade(creep.owner.username, amount, resourceType);
				delete memory.store[resourceType];
			}
		});
	}

	calculatePlayerTrade(username, amount, resourceType) {
		const opName = 'playerTrade:' + username;
		const operation = Game.operations[opName] || new Operation(opName);

		operation.recordStatChange(amount, resourceType);

		hivemind.log('trade', this.roomName).notify('Trade with', username, ':', amount, resourceType);
	}

	isThief(creep) {
		if (!this.memory.creepStatus) return false;
		if (!this.memory.creepStatus[creep.id]) return false;
		if (!this.memory.creepStatus[creep.id].isThief) return false;

		// @todo Mark as thief if player stole too many resources.

		return true;
	}

	/**
	 * Determines if a rampart should be opened or closed.
	 */
	calculateRampartState(rampart, allowed, forbidden) {
		if (allowed.length === 0) return false;
		if (forbidden.length === 0) return true;

		for (const creep of forbidden) {
			if (creep.pos.getRangeTo(rampart) <= 3) return false;
		}

		return true;
	}

	/**
	 * Checks if a creep is considered harmless.
	 */
	isUnarmedCreep(creep) {
		for (const part of creep.body) {
			if (part.type !== MOVE && part.type !== TOUGH && part.type !== CARRY) {
				return false;
			}
		}

		return true;
	}

	isInRoom(creep) {
		// @todo This is not correct when mincut ramparts are enabled.
		return creep.pos.x > 1 && creep.pos.y > 1 && creep.pos.x < 48 && creep.pos.y < 48;
	}

	isWhitelisted(username) {
		return hivemind.relations.isAlly(username) || _.includes(hivemind.settings.get('rampartWhitelistedUsers'), username);
	}
}
