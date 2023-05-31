/* global Creep PowerCreep RoomVisual RoomPosition LOOK_CREEPS OK
LOOK_CONSTRUCTION_SITES ERR_NO_PATH LOOK_STRUCTURES LOOK_POWER_CREEPS */

import cache from 'utils/cache';
import hivemind from 'hivemind';
import NavMesh from 'utils/nav-mesh';
import settings from 'settings-manager';
import utilities from 'utilities';
import {encodePosition, decodePosition, serializePositionPath, deserializePositionPath} from 'utils/serialization';

declare global {
	interface Creep {
		moveToRange: (target: RoomObject | RoomPosition, range: number, options?: GoToOptions) => boolean;
		whenInRange: (range: number, target: RoomObject | RoomPosition, callback: () => void) => void;
		setCachedPath: (path: Array<string | number>, reverse?: boolean, distance?: number) => void;
		getCachedPath: () => RoomPosition[] | null;
		hasCachedPath: () => boolean;
		clearCachedPath: () => void;
		hasArrived: () => boolean;
		followCachedPath: () => void;
		getOntoCachedPath: () => boolean;
		manageBlockingCreeps: () => void;
		incrementCachedPathPosition: () => void;
		moveAroundObstacles: () => boolean;
		canMoveOnto: (position: RoomPosition) => boolean;
		goTo: (target: RoomObject | RoomPosition, options?: GoToOptions) => boolean;
		calculateGoToPath: (target: RoomPosition, options?: GoToOptions) => boolean;
		moveToRoom: (roomName: string, allowDanger?: boolean) => boolean;
		calculateRoomPath: (roomName: string, allowDanger?: boolean) => string[] | null;
		isInRoom: () => boolean;
		interRoomTravel: (targetPos: RoomPosition, allowDanger?: boolean) => boolean;
		moveUsingNavMesh: (targetPos: RoomPosition, options?: GoToOptions) => OK | ERR_NO_PATH;
		getNavMeshMoveTarget: () => string | null;
		stopNavMeshMove: () => void;
		_blockingCreepMovement: Creep | PowerCreep;
		_hasMoveIntent: boolean;
		_requestedMoveArea?: {
			pos: RoomPosition;
			range: number;
		}
	}

	interface PowerCreep {
		moveToRange: (target: RoomObject | RoomPosition, range: number, options?: GoToOptions) => boolean;
		whenInRange: (range: number, target: RoomObject | RoomPosition, callback: () => void) => void;
		setCachedPath: (path: Array<string | number>, reverse?: boolean, distance?: number) => void;
		getCachedPath: () => RoomPosition[];
		hasCachedPath: () => boolean;
		clearCachedPath: () => void;
		hasArrived: () => boolean;
		followCachedPath: () => void;
		getOntoCachedPath: () => boolean;
		manageBlockingCreeps: () => void;
		incrementCachedPathPosition: () => void;
		moveAroundObstacles: () => boolean;
		canMoveOnto: (position: RoomPosition) => boolean;
		goTo: (target: RoomObject | RoomPosition, options?: GoToOptions) => boolean;
		calculateGoToPath: (target: RoomPosition, options?: GoToOptions) => boolean;
		moveToRoom: (roomName: string, allowDanger?: boolean) => boolean;
		calculateRoomPath: (roomName: string, allowDanger?: boolean) => string[] | null;
		isInRoom: () => boolean;
		interRoomTravel: (targetPos: RoomPosition, allowDanger?: boolean) => boolean;
		moveUsingNavMesh: (targetPos: RoomPosition, options?: GoToOptions) => OK | ERR_NO_PATH;
		getNavMeshMoveTarget: () => string | null;
		stopNavMeshMove: () => void;
		_blockingCreepMovement: Creep | PowerCreep;
		_hasMoveIntent: boolean;
		_requestedMoveArea?: {
			pos: RoomPosition;
			range: number;
		}
	}

	interface CachedPath {
		path: Array<string | number>;
		position: number;
		arrived: boolean;
		lastPositions: Record<number, string>;
		forceGoTo?: number;
	}

	interface CreepMemory {
		cachedPath?: CachedPath;
	}

	interface PowerCreepMemory {
		cachedPath?: CachedPath;
	}

	interface CreepHeapMemory {
		_decodedCachedPath?: RoomPosition[];
		_moveBlocked?: boolean;
		_mtrTarget?: string;
		_mtrNextRoom?: string;
		moveWithoutNavMesh?: boolean;
		_nmpt?: string;
		_nmp?: {
			path?: string[];
			incomplete: boolean;
		};
		_nmpi?: number;
	}

	interface PowerCreepHeapMemory {
		_decodedCachedPath?: RoomPosition[];
		_moveBlocked?: boolean;
		_mtrTarget?: string;
		_mtrNextRoom?: string;
		moveWithoutNavMesh?: boolean;
		_nmpt?: string;
		_nmp?: {
			path?: string[];
			incomplete: boolean;
		};
		_nmpi?: number;
	}
}

type GoToOptions = {
	range?: number;
	maxRooms?: number;
	allowDanger?: boolean;
};

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
Creep.prototype.moveToRange = function (this: Creep | PowerCreep, target, range, options) {
	if (!options) options = {};
	options.range = range;
	return this.goTo(target, options);
};

/**
 * Ensures that the creep is in range before performing an operation.
 */
Creep.prototype.whenInRange = function (this: Creep | PowerCreep, range, target, callback) {
	if (target instanceof RoomObject) {
		target = target.pos;
	}

	this._requestedMoveArea = {
		pos: target,
		range,
	}

	const visual = this.room.visual;
	if (visual && this.pos.getRangeTo(target) <= range) {
		const color = getVisualizationColor(this);
		visual.rect(
			target.x - range - 0.4,
			target.y - range - 0.4,
			2 * range + 0.8,
			2 * range + 0.8,
			{
				fill: 'transparent',
				stroke: color,
				lineStyle: 'dashed',
				strokeWidth: .2,
			}
		);
	}

	if (this.pos.getRangeTo(target) > range) {
		this.moveToRange(target, range);
		return;
	}

	callback();
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
Creep.prototype.setCachedPath = function (this: Creep | PowerCreep, path, reverse, distance) {
	path = _.clone(path);
	if (reverse || distance) {
		const originalPath = deserializePositionPath(path);
		if (reverse) {
			originalPath.reverse();
		}

		if (distance) {
			for (let i = 0; i < distance; i++) {
				originalPath.pop();
			}
		}

		path = serializePositionPath(originalPath);
	}

	delete this.heapMemory._decodedCachedPath;
	this.memory.cachedPath = {
		path,
		position: null,
		arrived: false,
		lastPositions: {},
	};
};

/**
 * Gets the current cached path for a creep.
 *
 * @return {RoomPosition[]}
 *   The creep's cached path as a list of room positions.
 */
Creep.prototype.getCachedPath = function (this: Creep | PowerCreep) {
	if (!this.hasCachedPath()) return null;

	if (!this.heapMemory._decodedCachedPath) {
		this.heapMemory._decodedCachedPath = deserializePositionPath(this.memory.cachedPath.path);
	}

	return this.heapMemory._decodedCachedPath;
};

/**
 * Checks if a creep has a path stored.
 *
 * @return {boolean}
 *   True if the creep has a cached path.
 */
Creep.prototype.hasCachedPath = function (this: Creep | PowerCreep) {
	return typeof this.memory.cachedPath !== 'undefined';
};

/**
 * Clears a creep's stored path.
 */
Creep.prototype.clearCachedPath = function (this: Creep | PowerCreep) {
	delete this.memory.cachedPath;
	delete this.heapMemory._decodedCachedPath;
};

/**
 * Checks if a creep has finished traversing it's stored path.
 *
 * @return {boolean}
 *   True if the creep has arrived.
 */
Creep.prototype.hasArrived = function (this: Creep | PowerCreep) {
	return this.hasCachedPath() && this.memory.cachedPath.arrived;
};

/**
 * Makes a creep follow it's cached path until the end.
 * @todo Sometimes we get stuck on a cicle of "getonit" and "Skip: 1".
 */
Creep.prototype.followCachedPath = function (this: Creep | PowerCreep) {
	drawCreepMovement(this);

	this._hasMoveIntent = true;
	this.heapMemory._moveBlocked = false;
	if (!this.memory.cachedPath || !this.memory.cachedPath.path || _.size(this.memory.cachedPath.path) === 0) {
		this.clearCachedPath();
		hivemind.log('creeps', this.room.name).error(this.name, 'Trying to follow non-existing path');
		return;
	}

	const path = this.getCachedPath();

	if (this.memory.cachedPath.forceGoTo) {
		const pos = path[this.memory.cachedPath.forceGoTo];

		if (this.pos.getRangeTo(pos) > 0) {
			const options: MoveToOpts = {};
			if (settings.get('visualizeCreepMovement')) {
				options.visualizePathStyle = {
					fill: 'transparent',
					stroke: '#f00',
					lineStyle: 'dashed',
					strokeWidth: .2,
					opacity: .1
				};
				this.say('S:' + pos.x + 'x' + pos.y);
			}

			if (this.moveTo(pos, options) === ERR_NO_PATH) {
				this.manageBlockingCreeps();
			}

			return;
		}

		this.memory.cachedPath.position = this.memory.cachedPath.forceGoTo;
		delete this.memory.cachedPath.forceGoTo;
	}
	else if (!this.memory.cachedPath.position) {
		if (this.getOntoCachedPath()) return;
	}

	// Make sure we don't have a string on our hands...
	this.memory.cachedPath.position = Number(this.memory.cachedPath.position);

	this.incrementCachedPathPosition();
	if (this.memory.cachedPath.arrived) return;

	if (this.moveAroundObstacles()) return;

	// Check if we've arrived at the end of our path.
	if (this.memory.cachedPath.position >= path.length - 1) {
		this.memory.cachedPath.arrived = true;
		return;
	}

	// Move towards next position.
	const next = path[this.memory.cachedPath.position + 1];
	if (next.roomName !== this.pos.roomName) {
		// Something went wrong, we must have gone off the path.
		delete this.memory.cachedPath.position;
		return;
	}

	this.move(this.pos.getDirectionTo(next));
};

/**
 * Moves a creep onto its cached path if possible.
 *
 * @return {boolean}
 *   True if we're currently trying to move onto the path, false if we
 *   reached it.
 */
Creep.prototype.getOntoCachedPath = function (this: Creep | PowerCreep) {
	const creep = this;
	const target = this.pos.findClosestByRange(this.getCachedPath(), {
		filter: pos => {
			// Try to move to a position on the path that is in the current room.
			if (pos.roomName !== this.room.name) return false;
			// Don't move onto exit tiles when looking to find our path.
			if (pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49) return false;

			// Only try to get on positions not blocked by other creeps.
			return creep.canMoveOnto(pos);
		},
	});

	if (!target) {
		// We're not in the correct room to move on this path. Kind of sucks, but try to get there using the default pathfinder anyway.
		// @todo Actually, we might be in the right room, but there are creeps on all parts of the path.
		if (this.pos.roomName === this.heapMemory._decodedCachedPath[0].roomName) {
			this.say('Blocked');

			// If a creep is blocking the next spot, tell it to move over if possible.
			this.manageBlockingCreeps();
		}
		else {
			this.say('Searching');
			this.moveTo(this.heapMemory._decodedCachedPath[0]);
		}

		this.heapMemory._moveBlocked = true;
		return true;
	}

	// Try to get to the closest part of the path.
	if (this.pos.x === target.x && this.pos.y === target.y) {
		// We've arrived on the path, time to get moving along it!
		const path = this.getCachedPath();
		for (const [i, element] of path.entries()) {
			if (this.pos.x === element.x && this.pos.y === element.y && this.pos.roomName === element.roomName) {
				this.memory.cachedPath.position = i;
				break;
			}
		}
	}
	else {
		// Get closer to the path.
		if (this.moveTo(target) === ERR_NO_PATH) {
			// Check if a path position is nearby, and blocked by a creep.
			this.manageBlockingCreeps();
		}

		this.say('getonit');
		return true;
	}

	return false;
};

Creep.prototype.manageBlockingCreeps = function (this: Creep | PowerCreep) {
	const path = this.getCachedPath();
	if (typeof this.memory.cachedPath.position === 'undefined' || this.memory.cachedPath.position === null) {
		for (const pos of path) {
			if (pos.getRangeTo(this.pos) > 1) continue;

			const creep = pos.lookFor(LOOK_CREEPS)[0];
			if (creep) {
				creep._blockingCreepMovement = this;
				return;
			}

			const powerCreep = pos.lookFor(LOOK_POWER_CREEPS)[0];
			if (powerCreep) {
				powerCreep._blockingCreepMovement = this;
				return;
			}
		}

		return;
	}

	let pos = path[this.memory.cachedPath.position];
	if (!pos || pos.roomName !== this.pos.roomName) return;
	if (this.pos.x !== pos.x || this.pos.y !== pos.y) {
		// Push away creep on current target tile.
		const creep = pos.lookFor(LOOK_CREEPS)[0];
		if (creep) creep._blockingCreepMovement = this;
		const powerCreep = pos.lookFor(LOOK_POWER_CREEPS)[0];
		if (powerCreep) powerCreep._blockingCreepMovement = this;
		return;
	}

	pos = path[this.memory.cachedPath.position + 1];
	if (!pos || pos.roomName !== this.pos.roomName) return;
	if (this.pos.x !== pos.x || this.pos.y !== pos.y) {
		// Push away creep on next target tile.
		const creep = pos.lookFor(LOOK_CREEPS)[0];
		if (creep) creep._blockingCreepMovement = this;
		const powerCreep = pos.lookFor(LOOK_POWER_CREEPS)[0];
		if (powerCreep) powerCreep._blockingCreepMovement = this;
	}
};

/**
 * Checks if movement last tick brought us on the next position of our path.
 */
Creep.prototype.incrementCachedPathPosition = function (this: Creep | PowerCreep) {
	// Check if we've already moved onto the next position.
	const path = this.getCachedPath();
	const next = path[this.memory.cachedPath.position + 1];
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
		const afterNext = path[this.memory.cachedPath.position + 2];
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
 * Checks if we've been blocked for a while and tries to move around the blockade.
 *
 * @return {boolean}
 *   True if we're currently moving around an obstacle.
 */
Creep.prototype.moveAroundObstacles = function (this: Creep | PowerCreep) {
	const REMEMBER_POSITION_COUNT = 5;

	// Record recent positions the creep has been on.
	// @todo Using Game.time here is unwise in case the creep is being throttled.
	// @todo Push and slice an array instead.
	if (!this.memory.cachedPath.lastPositions) {
		this.memory.cachedPath.lastPositions = {};
	}

	if (!('fatigue' in this) || this.fatigue === 0) {
		// If we're not fatigued, we're kind of stuck.
		this.memory.cachedPath.lastPositions[Game.time % REMEMBER_POSITION_COUNT] = encodePosition(this.pos);
	}

	// Go around obstacles if necessary.
	if (this.memory.cachedPath.forceGoTo) return false;

	// Check if we've moved at all during the previous ticks.
	let stuck = false;
	if (_.size(this.memory.cachedPath.lastPositions) > REMEMBER_POSITION_COUNT / 2) {
		let last = null;
		stuck = true;
		_.each(this.memory.cachedPath.lastPositions, position => {
			if (!last) last = position;
			if (last !== position) {
				// We have been on 2 different positions recently.
				stuck = false;
				return false;
			}

			return null;
		});
	}

	if (!stuck) return false;

	// If a creep is blocking the next spot, tell it to move over if possible.
	this.manageBlockingCreeps();

	// Try to find next free tile on the path.
	let i = this.memory.cachedPath.position + 1;

	const path = this.getCachedPath();
	while (i < path.length) {
		const pos = path[i];
		if (pos.roomName !== this.pos.roomName) {
			// Skip past exit tile in next room.
			i++;
			break;
		}

		if (this.canMoveOnto(pos)) break;

		i++;
	}

	if (i >= path.length) {
		// No free spots until end of path. Let normal pathfinder take over.
		this.memory.cachedPath.arrived = true;
		return true;
	}

	this.memory.cachedPath.forceGoTo = i;
	delete this.memory.cachedPath.lastPositions;

	return false;
};

/**
 * Checks if a creep could occupy the given position.
 *
 * @param {RoomPosition} position
 *   The position to check.
 *
 * @return {boolean}
 *   True if the creep could occupy this position.
 */
Creep.prototype.canMoveOnto = function (this: Creep | PowerCreep, position) {
	const creeps = position.lookFor(LOOK_CREEPS);
	if (creeps.length > 0 && creeps[0].id !== this.id) return false;

	const powerCreeps = position.lookFor(LOOK_POWER_CREEPS);
	if (powerCreeps.length > 0 && powerCreeps[0].id !== this.id) return false;

	const structures = position.lookFor(LOOK_STRUCTURES);
	for (const structure of structures) {
		if (!structure.isWalkable()) return false;
	}

	const sites = position.lookFor(LOOK_CONSTRUCTION_SITES);
	for (const site of sites) {
		if (!site.isWalkable()) return false;
	}

	return true;
};

function drawCreepMovement(creep: Creep | PowerCreep) {
	if (!RoomVisual) return;
	if (!settings.get('visualizeCreepMovement')) return;

	const target = creep.memory.go?.target ? decodePosition(creep.memory.go.target) : null;

	const color = getVisualizationColor(creep);
	const pathPosition = creep.memory.cachedPath?.position || creep.memory.cachedPath?.forceGoTo;
	if (!pathPosition && target) {
		creep.room.visual.line(creep.pos, target, {
			color,
			width: .05,
			opacity: .5,
		});
		return;
	}

	const path = creep.getCachedPath();

	const steps: RoomPosition[] = [];
	for (let i = pathPosition; i < path.length; i++) {
		const pos = path[i];
		if (pos.roomName !== creep.pos.roomName) break;

		steps.push(pos);
	}

	creep.room.visual.poly(steps, {
		fill: 'transparent',
		stroke: color,
		lineStyle: 'dashed',
		strokeWidth: .15,
		opacity: .3,
	});

	if (!target) return;

	const lineStartPos = steps.length > 0 ? steps.pop() : creep.pos;
	if (lineStartPos.roomName !== target.roomName) return;

	creep.room.visual.line(lineStartPos, target, {
		color: color,
		width: .15,
		opacity: .3,
	});
}

function getVisualizationColor(creep: Creep | PowerCreep) {
	const hue: number = cache.inHeap('creepColor:' + creep.name, 10000, (oldValue) => {
		return oldValue?.data ?? Math.floor(Math.random() * 360);
	});
	return 'hsl(' + hue + ', 50%, 50%)'
}

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
Creep.prototype.goTo = function (this: Creep | PowerCreep, target, options) {
	if (!target) return false;
	if (!options) options = {};

	this._hasMoveIntent = true;
	if (!this.memory.go || this.memory.go.lastAccess < Game.time - 10) {
		// Reset pathfinder memory.
		this.memory.go = {
			lastAccess: Game.time,
		};
	}

	if (target instanceof RoomObject) {
		target = target.pos;
	}

	const range = options.range || 0;
	const targetPos = encodePosition(target);
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

		if (this.heapMemory._moveBlocked) {
			// Seems like we can't move on the target space for some reason right now.
			// This should be rare, so we use the default pathfinder to get us the rest of the way there.
			if (this.pos.getRangeTo(target) > range) {
				const result = this.moveTo(target, {range});
				if (result === ERR_NO_PATH) return false;
			}
			else if (this.pos.roomName === target.roomName) {
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
Creep.prototype.calculateGoToPath = function (this: Creep | PowerCreep, target, options) {
	const targetPos = encodePosition(target);
	this.memory.go.target = targetPos;

	const pfOptions: any = {};
	if (this.memory.singleRoom) {
		if (this.pos.roomName === this.memory.singleRoom) {
			pfOptions.maxRooms = 1;
		}

		pfOptions.singleRoom = this.memory.singleRoom;
	}

	pfOptions.maxRooms = options.maxRooms;
	pfOptions.allowDanger = options.allowDanger;

	// Always allow pathfinding in current room.
	pfOptions.whiteListRooms = [this.pos.roomName];

	// Calculate a path to take.
	const result = utilities.getPath(this.pos, {
		pos: target,
		range: options.range || 0,
	}, false, pfOptions);

	if (result && result.path) {
		this.setCachedPath(serializePositionPath(result.path));
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
 * @param {boolean} allowDanger
 *   If true, creep may move through unsafe rooms.
 *
 * @return {boolean}
 *   True if movement is possible and ongoing.
 */
Creep.prototype.moveToRoom = function (this: Creep | PowerCreep, roomName, allowDanger) {
	// Make sure we recalculate path if target changes.
	if (this.heapMemory._mtrTarget !== roomName) {
		delete this.heapMemory._mtrNextRoom;
		this.heapMemory._mtrTarget = roomName;
	}

	// Check which room to go to next.
	if (!this.heapMemory._mtrNextRoom || (this.pos.roomName === this.heapMemory._mtrNextRoom && this.isInRoom())) {
		const path = this.calculateRoomPath(roomName, allowDanger);
		if (_.size(path) < 1) {
			// There is no valid path.
			return false;
		}

		this.heapMemory._mtrNextRoom = path[0];
	}

	// Move to next room.
	const target = new RoomPosition(25, 25, this.heapMemory._mtrNextRoom);
	if (this.pos.getRangeTo(target) > 15) {
		return this.moveToRange(target, 15);
	}

	return true;
};

/**
 * Generates a list of rooms the creep needs to travel through to get to the target room.
 *
 * @param {string} roomName
 *   Name of the target room for finding a path.
 * @param {boolean} allowDanger
 *   If true, creep may move through unsafe rooms.
 *
 * @return {string[]|null}
 *   An array of room names, not including the current room, or null if no path
 *   could be found.
 */
Creep.prototype.calculateRoomPath = function (this: Creep | PowerCreep, roomName, allowDanger) {
	return this.room.calculateRoomPath(roomName, {allowDanger});
};

Creep.prototype.isInRoom = function (this: Creep | PowerCreep) {
	return this.pos.x > 2 && this.pos.x < 47 && this.pos.y > 2 && this.pos.y < 47;
};

Creep.prototype.interRoomTravel = function (this: Creep | PowerCreep, targetPos, allowDanger = false) {
	const isInTargetRoom = this.pos.roomName === targetPos.roomName;
	if (!isInTargetRoom || (!this.isInRoom() && this.getNavMeshMoveTarget())) {
		if (this.heapMemory.moveWithoutNavMesh) {
			if (!this.moveToRoom(targetPos.roomName, allowDanger)) {
				return false;
			}

			return true;
		}

		if (this.moveUsingNavMesh(targetPos, {allowDanger}) !== OK) {
			hivemind.log('creeps').debug(this.name, 'can\'t move from', this.pos.roomName, 'to', targetPos.roomName);

			// Try moving to target room without using nav mesh.
			this.heapMemory.moveWithoutNavMesh = true;
		}

		return true;
	}

	this.stopNavMeshMove();
	return false;
};

Creep.prototype.moveUsingNavMesh = function (this: Creep | PowerCreep, targetPos, options) {
	if (!hivemind.segmentMemory.isReady()) return OK;

	if (!options) options = {};

	const pos = encodePosition(targetPos);
	if (!this.heapMemory._nmpt || !this.heapMemory._nmp || this.heapMemory._nmpt !== pos) {
		this.heapMemory._nmpt = pos;
		const mesh = new NavMesh();
		const path = mesh.findPath(this.pos, targetPos, options);
		this.heapMemory._nmp = {
			incomplete: path.incomplete,
			path: path.path ? _.map(path.path, encodePosition) : null,
		};

		this.heapMemory._nmpi = 0;
	}

	if (!this.heapMemory._nmp.path) {
		if (this.moveToRoom(targetPos.roomName)) return OK;

		return ERR_NO_PATH;
	}

	const nextPos = decodePosition(this.heapMemory._nmp.path[this.heapMemory._nmpi]);
	if (this.pos.roomName !== nextPos.roomName || this.pos.getRangeTo(nextPos) > 1) {
		const moveResult = this.moveToRange(nextPos, 1, options);
		if (!moveResult) {
			// Couldn't get to next path target.
			// @todo Recalculate route?
			return ERR_NO_PATH;
		}
	}

	// If we reach a waypoint, increment path index.
	if (this.pos.getRangeTo(nextPos) <= 1 && this.heapMemory._nmpi < this.heapMemory._nmp.path.length - 1) {
		this.heapMemory._nmpi++;
		const nextPos = decodePosition(this.heapMemory._nmp.path[this.heapMemory._nmpi]);
		const moveResult = this.moveToRange(nextPos, 1, options);
		if (!moveResult) {
			// Couldn't get to next path target.
			// @todo Recalculate route?
			return ERR_NO_PATH;
		}
	}

	return OK;
};

Creep.prototype.getNavMeshMoveTarget = function (this: Creep | PowerCreep) {
	return this.heapMemory._nmpt;
};

Creep.prototype.stopNavMeshMove = function (this: Creep | PowerCreep) {
	delete this.heapMemory._nmpt;
	delete this.heapMemory._nmp;
	delete this.heapMemory._nmpi;
	delete this.heapMemory.moveWithoutNavMesh;
};

PowerCreep.prototype.moveToRange = Creep.prototype.moveToRange;
PowerCreep.prototype.whenInRange = Creep.prototype.whenInRange;
PowerCreep.prototype.setCachedPath = Creep.prototype.setCachedPath;
PowerCreep.prototype.getCachedPath = Creep.prototype.getCachedPath;
PowerCreep.prototype.hasCachedPath = Creep.prototype.hasCachedPath;
PowerCreep.prototype.clearCachedPath = Creep.prototype.clearCachedPath;
PowerCreep.prototype.hasArrived = Creep.prototype.hasArrived;
PowerCreep.prototype.followCachedPath = Creep.prototype.followCachedPath;
PowerCreep.prototype.getOntoCachedPath = Creep.prototype.getOntoCachedPath;
PowerCreep.prototype.incrementCachedPathPosition = Creep.prototype.incrementCachedPathPosition;
PowerCreep.prototype.moveAroundObstacles = Creep.prototype.moveAroundObstacles;
PowerCreep.prototype.canMoveOnto = Creep.prototype.canMoveOnto;
PowerCreep.prototype.goTo = Creep.prototype.goTo;
PowerCreep.prototype.calculateGoToPath = Creep.prototype.calculateGoToPath;
PowerCreep.prototype.moveToRoom = Creep.prototype.moveToRoom;
PowerCreep.prototype.calculateRoomPath = Creep.prototype.calculateRoomPath;
PowerCreep.prototype.manageBlockingCreeps = Creep.prototype.manageBlockingCreeps;
PowerCreep.prototype.isInRoom = Creep.prototype.isInRoom;
PowerCreep.prototype.moveUsingNavMesh = Creep.prototype.moveUsingNavMesh;
PowerCreep.prototype.getNavMeshMoveTarget = Creep.prototype.getNavMeshMoveTarget;
PowerCreep.prototype.stopNavMeshMove = Creep.prototype.stopNavMeshMove;

