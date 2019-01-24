'use strict';

var utilities = require('utilities');

// @todo For multi-room movement we could save which rooms we're travelling through, and recalculate (part of) the path when a CostMatrix changes.
// That info should probably live in global memory, we don't want that serialized...

/**
 * Moves creep within a certain range of a target.
 */
Creep.prototype.moveToRange = function (target, range) {
	return this.goTo(target, {range: range});
};

/**
 * Saves a cached path in a creeps memory for use.
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
		path: path,
		position: null,
		arrived: false,
		lastPositions: {},
	};
};

/**
 * Checks if a creep has a path stored.
 */
Creep.prototype.hasCachedPath = function () {
	return typeof this.memory.cachedPath != 'undefined';
};

/**
 * Clears a creep's stored path.
 */
Creep.prototype.clearCachedPath = function () {
	delete this.memory.cachedPath;
};

/**
 * Checks if a creep has finished traversing it's stored path.
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
	if (!this.memory.cachedPath || !this.memory.cachedPath.path || _.size(this.memory.cachedPath.path) == 0) {
		this.clearCachedPath();
		hivemind.log('creeps', this.room.name).error(this.name, 'Trying to follow non-existing path');
		return;
	}
	var path = this.memory.cachedPath.path;

	if (this.memory.cachedPath.forceGoTo) {
		let pos = utilities.decodePosition(path[this.memory.cachedPath.forceGoTo]);

		if (this.pos.getRangeTo(pos) > 0) {
			//this.say('Skip:' + this.memory.cachedPath.forceGoTo);
			this.say('S:' + pos.x + 'x' + pos.y);
			this.moveTo(pos);
			return;
		}
		else {
			this.memory.cachedPath.position = this.memory.cachedPath.forceGoTo;
			delete this.memory.cachedPath.forceGoTo;
		}
	}
	else if (!this.memory.cachedPath.position) {
		let decodedPath = utilities.deserializePositionPath(this.memory.cachedPath.path);
		let target = this.pos.findClosestByRange(decodedPath, {
			filter: (pos) => {
				if (pos.roomName != this.room.name) return false;
				if (pos.x == 0 || pos.x == 49 || pos.y == 0 || pos.y == 49) {
					return false;
				}

				// Only try to get to paths where no creep is positioned.
				var creeps = pos.lookFor(LOOK_CREEPS);
				if (creeps.length > 0 && creeps[0].name != this.name) return false;

				var structures = pos.lookFor(LOOK_STRUCTURES);
				for (let i in structures) {
					if (structures[i].structureType != STRUCTURE_ROAD && structures[i].structureType != STRUCTURE_CONTAINER && structures[i].structureType != STRUCTURE_RAMPART) {
						return false;
					}
				}

				var sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
				for (let i in sites) {
					if (sites[i].structureType != STRUCTURE_ROAD && sites[i].structureType != STRUCTURE_CONTAINER && sites[i].structureType != STRUCTURE_RAMPART) {
						return false;
					}
				}

				return true;
			}
		});
		if (!target) {
			// We're not in the correct room to move on this path. Kind of sucks, but try to get there using the default pathfinder anyway.
			// @todo Actually, we might be in the right room, but there are creeps on all parts of the path.
			if (this.pos.roomName != decodedPath[0].roomName) {
				this.moveTo(decodedPath[0]);
				this.say('Searching');
			}
			else {
				this.say('Blocked');
			}
			this.memory.moveBlocked = true;
			return;
		}
		else {
			// Try to get to the closest part of the path.
			if (this.pos.x == target.x && this.pos.y == target.y) {
				// We've arrived on the path, time to get moving along it!
				for (let i in decodedPath) {
					if (this.pos.x == decodedPath[i].x && this.pos.y == decodedPath[i].y && this.pos.roomName == decodedPath[i].roomName) {
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
	}

	// Make sure we don't have a string on our hands...
	this.memory.cachedPath.position = this.memory.cachedPath.position * 1;

	// Check if we've already moved onto the next position.
	let next = utilities.decodePosition(path[this.memory.cachedPath.position + 1]);
	if (!next) {
		// Out of range, so we're probably at the end of the path.
		this.memory.cachedPath.arrived = true;
		return;
	}

	if (next.x == this.pos.x && next.y == this.pos.y) {
		this.memory.cachedPath.position++;
	}
	else if (next.roomName != this.pos.roomName) {
		// We just changed rooms.
		let afterNext = utilities.decodePosition(path[this.memory.cachedPath.position + 2]);
		if (afterNext && afterNext.roomName == this.pos.roomName && afterNext.getRangeTo(this.pos) <= 1) {
			this.memory.cachedPath.position += 2;

			//console.log('path room switch', this.name, this.memory.cachedPath.position);
		}
		else if (!afterNext) {
			delete this.memory.cachedPath.forceGoTo;
			delete this.memory.cachedPath.lastPositions;
		}
	}

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
			for (let i in this.memory.cachedPath.lastPositions) {
				if (!last) {
					last = this.memory.cachedPath.lastPositions[i];
				}
				if (last != this.memory.cachedPath.lastPositions[i]) {
					stuck = false;
					break;
				}
			}
		}
		if (stuck) {
			//console.log(this.name, 'has been stuck for the last', _.size(this.memory.cachedPath.lastPositions), 'ticks. Trying to go around blockade.');
			let i = this.memory.cachedPath.position + 1;
			while (i < path.length) {
				let step = utilities.decodePosition(path[i]);
				if (step.roomName != this.pos.roomName) {
					// Skip past exit tile in next room.
					i++;
					break;
				}

				// Only try to get to paths where no creep is positioned.
				var creeps = step.lookFor(LOOK_CREEPS);
				var structures = step.lookFor(LOOK_STRUCTURES);
				var sites = step.lookFor(LOOK_CONSTRUCTION_SITES);

				var blocked = creeps.length > 0 && creeps[0].name != this.name;
				for (let i in structures) {
					if (structures[i].structureType != STRUCTURE_ROAD && structures[i].structureType != STRUCTURE_CONTAINER) {
						blocked = true;
					}
				}
				for (let i in sites) {
					if (sites[i].structureType != STRUCTURE_ROAD && sites[i].structureType != STRUCTURE_CONTAINER) {
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
			else {
				//console.log(this.name, 'going to pos', i);
				this.memory.cachedPath.forceGoTo = i;
				delete this.memory.cachedPath.lastPositions;
			}
		}

		// Check if we've arrived at the end of our path.
		if (this.memory.cachedPath.position >= path.length - 1) {
			this.memory.cachedPath.arrived = true;
			return;
		}
	}

	// Move towards next position.
	next = utilities.decodePosition(path[this.memory.cachedPath.position + 1]);
	if (!next) {
		// Out of range, so we're probably at the end of the path.
		this.memory.cachedPath.arrived = true;
		return;
	}

	if (next.roomName != this.pos.roomName) {
		// Something went wrong, we must have gone off the path.
		delete this.memory.cachedPath.position;
		//console.log('path reeinitialize', this.name);
		return;
	}

	let direction = this.pos.getDirectionTo(next);
	this.move(direction);
};

/**
 * Replacement for default moveTo that uses cached paths while trying to go around targets.
 */
Creep.prototype.goTo = function (target, options) {
	if (!target) return false;
	if (!options) options = {};

	if (!this.memory.go || this.memory.go.lastAccess < Game.time - 10) {
		this.memory.go = {
			lastAccess: Game.time,
		};
	}

	if (target.pos) {
		target = target.pos;
	}

	let range = 0;
	if (options.range) {
		range = options.range;
	}

	let targetPos = utilities.encodePosition(target);
	if (!this.memory.go.target || this.memory.go.target != targetPos || !this.hasCachedPath()) {
		this.memory.go.target = targetPos;

		let pfOptions = {};
		if (this.memory.singleRoom) {
			if (this.pos.roomName == this.memory.singleRoom) {
				pfOptions.maxRooms = 1;
			}
			pfOptions.singleRoom = this.memory.singleRoom;
		}

		if (options.maxRooms) {
			pfOptions.maxRooms = options.maxRooms;
		}

		// Always allow pathfinding in current room.
		pfOptions.whiteListRooms = [this.pos.roomName];

		// Calculate a path to take.
		var result = utilities.getPath(this.pos, {pos: target, range: range}, false, pfOptions);

		if (result && result.path) {
			//console.log('found path in', result.ops, 'operations', result.path);
			//hivemind.log('creeps', this.room.name).debug('New path calculated from', this.pos, 'to', target, 'in', result.ops, 'operations');

			this.setCachedPath(utilities.serializePositionPath(result.path));
		}
		else {
			hivemind.log('creeps', this.room.name).error('No path from', this.pos, 'to', target, 'found!');
			return false;
		}
	}
	this.memory.go.lastAccess = Game.time;

	if (!this.hasArrived()) {
		this.followCachedPath();

		// Debug creep movement.
		new RoomVisual(this.pos.roomName).line(this.pos, target);

		if (this.memory.moveBlocked) {
			// Seems like we can't move on the target space for some reason right now.
			// This should be rare, so we use the default pathfinder to get us the rest of the way there.
			if (this.pos.getRangeTo(target) > range && this.pos.getRangeTo(target) < range + 5) {
				let result = this.moveTo(target);
				if (result == ERR_NO_PATH) return false;
			}
			else if (this.pos.roomName == targetPos.roomName) {
				return false;
			}
		}
	}
	else {
		this.clearCachedPath();
	}
	return true;
};

/**
 * Makes this creep move to a certain room.
 */
Creep.prototype.moveToRoom = function (roomName) {
	// Check which room to go to next.
	let inRoom = (this.pos.x > 2 && this.pos.x < 47 && this.pos.y > 2 && this.pos.y < 47);
	if (!this.memory.nextRoom || (this.pos.roomName == this.memory.nextRoom && inRoom)) {
		let path = this.calculateRoomPath(roomName);
		if (_.size(path) < 1) {
			return false;
		}

		this.memory.nextRoom = path[0];
	}

	// Move to next room.
	let target = new RoomPosition(25, 25, this.memory.nextRoom);
	if (this.pos.getRangeTo(target) > 15) {
		this.moveToRange(target, 15);
	}

	return true;
};

/**
 * Generates a list of rooms the creep needs to travel through to get to the target room.
 */
Creep.prototype.calculateRoomPath = function (targetRoom) {
	return this.room.calculateRoomPath(targetRoom);
};
