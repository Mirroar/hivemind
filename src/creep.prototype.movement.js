'use strict';

/* global hivemind Creep RoomVisual RoomPosition LOOK_CREEPS LOOK_STRUCTURES
STRUCTURE_ROAD STRUCTURE_CONTAINER LOOK_CONSTRUCTION_SITES STRUCTURE_RAMPART
ERR_NO_PATH */

const utilities = require('./utilities');

// @todo For multi-room movement we could save which rooms we're travelling through, and recalculate (part of) the path when a CostMatrix changes.
// That info should probably live in global memory, we don't want that serialized...

/**
 * Moves creep within a certain range of a target.
 *
 * @param {RoomObject} target
 *   The target to move towards.
 * @param {number} range
 *   The requested distance toward the target.
 *
 * @return {boolean}
 *   Whether the movement succeeded.
 */
Creep.prototype.moveToRange = function (target, range) {
	return this.goTo(target, {range});
};

/**
 * Saves a cached path in a creeps memory for use.
 *
 * @param {string[]} path
 *   An array of encoded room positions the path consists of.
 * @param {boolean} reverse
 *   If set, the path is traversed in the opposite direction.
 * @param {number} distance
 *   How close to the end of the path the creep is supposed to travel.
 */
Creep.prototype.setCachedPath = function (path, reverse, distance) {
	path = _.clone(path);
	if (reverse) {
		path.reverse();
	}

	if (distance) {
		for (let i = 0; i < distance; i++) {
			path.pop();
		}
	}

	this.memory.cachedPath = {
		path,
		position: null,
		arrived: false,
		lastPositions: {},
	};
};

/**
 * Checks if a creep has a path stored.
 *
 * @return {boolean}
 *   True if the creep has a cached path.
 */
Creep.prototype.hasCachedPath = function () {
	return typeof this.memory.cachedPath !== 'undefined';
};

/**
 * Clears a creep's stored path.
 */
Creep.prototype.clearCachedPath = function () {
	delete this.memory.cachedPath;
};

/**
 * Checks if a creep has finished traversing it's stored path.
 *
 * @return {boolean}
 *   True if the creep has arrived.
 */
Creep.prototype.hasArrived = function () {
	return this.memory.cachedPath && this.memory.cachedPath.arrived;
};

/**
 * Makes a creep follow it's cached path until the end.
 * @todo Sometimes we get stuck on a cicle of "getonit" and "Skip: 1".
 */
Creep.prototype.followCachedPath = function () {
	this.memory.moveBlocked = false;
	if (!this.memory.cachedPath || !this.memory.cachedPath.path || _.size(this.memory.cachedPath.path) === 0) {
		this.clearCachedPath();
		hivemind.log('creeps', this.room.name).error(this.name, 'Trying to follow non-existing path');
		return;
	}

	const path = this.memory.cachedPath.path;

	if (this.memory.cachedPath.forceGoTo) {
		const pos = utilities.decodePosition(path[this.memory.cachedPath.forceGoTo]);

		if (this.pos.getRangeTo(pos) > 0) {
			this.say('S:' + pos.x + 'x' + pos.y);
			this.moveTo(pos);
			return;
		}

		this.memory.cachedPath.position = this.memory.cachedPath.forceGoTo;
		delete this.memory.cachedPath.forceGoTo;
	}
	else if (!this.memory.cachedPath.position) {
		const decodedPath = utilities.deserializePositionPath(this.memory.cachedPath.path);
		const target = this.pos.findClosestByRange(decodedPath, {
			filter: pos => {
				if (pos.roomName !== this.room.name) return false;
				if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) {
					return false;
				}

				// Only try to get to paths where no creep is positioned.
				const creeps = pos.lookFor(LOOK_CREEPS);
				if (creeps.length > 0 && creeps[0].name !== this.name) return false;

				const structures = pos.lookFor(LOOK_STRUCTURES);
				for (const structure of structures) {
					if (structure.structureType !== STRUCTURE_ROAD && structure.structureType !== STRUCTURE_CONTAINER && structure.structureType !== STRUCTURE_RAMPART) {
						return false;
					}
				}

				const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
				for (const site of sites) {
					if (site.structureType !== STRUCTURE_ROAD && site.structureType !== STRUCTURE_CONTAINER && site.structureType !== STRUCTURE_RAMPART) {
						return false;
					}
				}

				return true;
			},
		});

		if (!target) {
			// We're not in the correct room to move on this path. Kind of sucks, but try to get there using the default pathfinder anyway.
			// @todo Actually, we might be in the right room, but there are creeps on all parts of the path.
			if (this.pos.roomName === decodedPath[0].roomName) {
				this.say('Blocked');
			}
			else {
				this.moveTo(decodedPath[0]);
				this.say('Searching');
			}

			this.memory.moveBlocked = true;
			return;
		}

		// Try to get to the closest part of the path.
		if (this.pos.x === target.x && this.pos.y === target.y) {
			// We've arrived on the path, time to get moving along it!
			for (const i in decodedPath) {
				if (this.pos.x === decodedPath[i].x && this.pos.y === decodedPath[i].y && this.pos.roomName === decodedPath[i].roomName) {
					this.memory.cachedPath.position = i;
					break;
				}
			}

			if (!this.memory.cachedPath.position) {
				return;
			}
		}
		else {
			// Get closer to the path.
			this.moveTo(target);
			this.say('getonit');
			return;
		}
	}

	// Make sure we don't have a string on our hands...
	this.memory.cachedPath.position = Number(this.memory.cachedPath.position);

	this.checkIfMovedOnNextPosition(path);
	if (this.memory.cachedPath.arrived) return;

	this.say('Pos: ' + this.memory.cachedPath.position);

	// @todo Check if we've been blocked for a while and try to move around the blockade.
	// Check if we've moved at all during the previous ticks.
	if (!this.memory.cachedPath.lastPositions) {
		this.memory.cachedPath.lastPositions = {};
	}

	this.memory.cachedPath.lastPositions[Game.time % 5] = utilities.encodePosition(this.pos);

	// Go around obstacles if necessary.
	if (!this.memory.cachedPath.forceGoTo) {
		let stuck = false;
		if (_.size(this.memory.cachedPath.lastPositions) > 5 / 2) {
			let last = null;
			stuck = true;
			_.each(this.memory.cachedPath.lastPositions, position => {
				if (!last) last = position;
				if (last !== position) {
					stuck = false;
					return false;
				}
			});
		}

		if (stuck) {
			let i = this.memory.cachedPath.position + 1;
			while (i < path.length) {
				const step = utilities.decodePosition(path[i]);
				if (step.roomName !== this.pos.roomName) {
					// Skip past exit tile in next room.
					i++;
					break;
				}

				// Only try to get to paths where no creep is positioned.
				const creeps = step.lookFor(LOOK_CREEPS);
				const structures = step.lookFor(LOOK_STRUCTURES);
				const sites = step.lookFor(LOOK_CONSTRUCTION_SITES);

				let blocked = creeps.length > 0 && creeps[0].name !== this.name;
				for (const structure of structures) {
					if (structure.structureType !== STRUCTURE_ROAD && structure.structureType !== STRUCTURE_CONTAINER) {
						blocked = true;
					}
				}

				for (const site of sites) {
					if (site.structureType !== STRUCTURE_ROAD && site.structureType !== STRUCTURE_CONTAINER) {
						blocked = true;
					}
				}

				if (!blocked) break;

				i++;
			}

			if (i >= path.length) {
				// No free spots until end of path. Let normal pathfinder take over.
				this.memory.cachedPath.arrived = true;
				return;
			}

			this.memory.cachedPath.forceGoTo = i;
			delete this.memory.cachedPath.lastPositions;
		}

		// Check if we've arrived at the end of our path.
		if (this.memory.cachedPath.position >= path.length - 1) {
			this.memory.cachedPath.arrived = true;
			return;
		}
	}

	// Move towards next position.
	const next = utilities.decodePosition(path[this.memory.cachedPath.position + 1]);
	if (!next) {
		// Out of range, so we're probably at the end of the path.
		this.memory.cachedPath.arrived = true;
		return;
	}

	if (next.roomName !== this.pos.roomName) {
		// Something went wrong, we must have gone off the path.
		delete this.memory.cachedPath.position;
		return;
	}

	this.move(this.pos.getDirectionTo(next));
};

/**
 * Checks if movement last tick brought us on the next position of our path.
 *
 * @param {string[]} path
 *   An array of encoded room positions.
 */
Creep.prototype.checkIfMovedOnNextPosition = function (path) {
	// Check if we've already moved onto the next position.
	const next = utilities.decodePosition(path[this.memory.cachedPath.position + 1]);
	if (!next) {
		// Out of range, so we're probably at the end of the path.
		this.memory.cachedPath.arrived = true;
		return;
	}

	if (next.x === this.pos.x && next.y === this.pos.y) {
		this.memory.cachedPath.position++;
		return;
	}

	if (next.roomName !== this.pos.roomName) {
		// We just changed rooms.
		const afterNext = utilities.decodePosition(path[this.memory.cachedPath.position + 2]);
		if (afterNext && afterNext.roomName === this.pos.roomName && afterNext.getRangeTo(this.pos) <= 1) {
			this.memory.cachedPath.position += 2;
		}
		else if (!afterNext) {
			delete this.memory.cachedPath.forceGoTo;
			delete this.memory.cachedPath.lastPositions;
		}
	}
};

/**
 * Moves a creep using cached paths while moving around obstacles.
 *
 * @param {RoomPosition|RoomObject} target
 *   The target to move towards.
 * @param {object} options
 *   Further optional options for pathfinding consisting of:
 *   - range: How close to the target we need to move.
 *   - maxRooms: Maximum number of rooms for finding a path.
 *
 * @return {boolean}
 *   True if movement is possible and ongoing.
 */
Creep.prototype.goTo = function (target, options) {
	if (!target) return false;
	if (!options) options = {};

	if (!this.memory.go || this.memory.go.lastAccess < Game.time - 10) {
		// Reset pathfinder memory.
		this.memory.go = {
			lastAccess: Game.time,
		};
	}

	if (target.pos) {
		target = target.pos;
	}

	const range = options.range || 0;
	const targetPos = utilities.encodePosition(target);
	if (!this.memory.go.target || this.memory.go.target !== targetPos || !this.hasCachedPath()) {
		if (!this.calculateGoToPath(target, options)) {
			hivemind.log('creeps', this.room.name).error('No path from', this.pos, 'to', target, 'found!');
			return false;
		}
	}

	this.memory.go.lastAccess = Game.time;

	if (this.hasArrived()) {
		this.clearCachedPath();
	}
	else {
		this.followCachedPath();

		// Debug creep movement.
		new RoomVisual(this.pos.roomName).line(this.pos, target);

		if (this.memory.moveBlocked) {
			// Seems like we can't move on the target space for some reason right now.
			// This should be rare, so we use the default pathfinder to get us the rest of the way there.
			if (this.pos.getRangeTo(target) > range && this.pos.getRangeTo(target) < range + 5) {
				const result = this.moveTo(target);
				if (result === ERR_NO_PATH) return false;
			}
			else if (this.pos.roomName === targetPos.roomName) {
				return false;
			}
		}
	}

	return true;
};

/**
 * Calculates and caches the exact path a creep is supposed to take.
 *
 * @param {RoomPosition} target
 *   The target to move towards.
 * @param {object} options
 *   Further options for pathfinding.
 *   @see Creep.prototype.goTo()
 *
 * @return {boolean}
 *   True if a path was successfully generated.
 */
Creep.prototype.calculateGoToPath = function (target, options) {
	const targetPos = utilities.encodePosition(target);
	this.memory.go.target = targetPos;

	const pfOptions = {};
	if (this.memory.singleRoom) {
		if (this.pos.roomName === this.memory.singleRoom) {
			pfOptions.maxRooms = 1;
		}

		pfOptions.singleRoom = this.memory.singleRoom;
	}

	pfOptions.maxRooms = options.maxRooms;

	// Always allow pathfinding in current room.
	pfOptions.whiteListRooms = [this.pos.roomName];

	// Calculate a path to take.
	const result = utilities.getPath(this.pos, {
		pos: target,
		range: options.range || 0,
	}, false, pfOptions);

	if (result && result.path) {
		this.setCachedPath(utilities.serializePositionPath(result.path));
	}
	else {
		return false;
	}

	return true;
};

/**
 * Makes this creep move to a certain room.
 *
 * @param {string} roomName
 *   Name of the room to try and move to.
 *
 * @return {boolean}
 *   True if movement is possible and ongoing.
 */
Creep.prototype.moveToRoom = function (roomName) {
	// Check which room to go to next.
	const inRoom = (this.pos.x > 2 && this.pos.x < 47 && this.pos.y > 2 && this.pos.y < 47);
	if (!this.memory.nextRoom || (this.pos.roomName === this.memory.nextRoom && inRoom)) {
		const path = this.calculateRoomPath(roomName);
		if (_.size(path) < 1) {
			return false;
		}

		this.memory.nextRoom = path[0];
	}

	// Move to next room.
	const target = new RoomPosition(25, 25, this.memory.nextRoom);
	if (this.pos.getRangeTo(target) > 15) {
		this.moveToRange(target, 15);
	}

	return true;
};

/**
 * Generates a list of rooms the creep needs to travel through to get to the target room.
 *
 * @param {string} roomName
 *   Name of the target room for finding a path.
 *
 * @return {string[]|null}
 *   An array of room names, not including the current room, or null if no path
 *   could be found.
 */
Creep.prototype.calculateRoomPath = function (roomName) {
	return this.room.calculateRoomPath(roomName);
};
