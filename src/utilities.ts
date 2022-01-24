/* global hivemind PathFinder Room RoomPosition TERRAIN_MASK_WALL REACTIONS
OBSTACLE_OBJECT_TYPES STRUCTURE_RAMPART STRUCTURE_ROAD BODYPART_COST
TOP TOP_RIGHT RIGHT BOTTOM_RIGHT BOTTOM BOTTOM_LEFT LEFT TOP_LEFT
STRUCTURE_PORTAL STRUCTURE_KEEPER_LAIR */

declare global {
	type TileCallback = (x: number, y: number) => boolean | void;
}

import cache from 'utils/cache';
import hivemind from 'hivemind';
import {ErrorMapper} from 'utils/ErrorMapper';
import {getRoomIntel} from 'intel-management';
import {serializeCoords, serializePosition, encodePosition} from 'utils/serialization';

let ownUserName;

const utilities = {

	/**
	 * Dynamically determines the username of the current user.
	 *
	 * @return {string}
	 *   The determined user name.
	 */
	getUsername(): string {
		if (ownUserName) return ownUserName;

		if (_.size(Game.spawns) === 0) {
			if (_.size(Game.creeps) === 0) return '@undefined';

			ownUserName = _.sample(Game.creeps).owner.username;
			return ownUserName;
		}

		ownUserName = _.sample(Game.spawns).owner.username;
		return ownUserName;
	},

	/**
	 * Runs a callback within a try/catch block.
	 *
	 * @param {function} callback
	 *   The callback to run.
	 *
	 * @return {mixed}
	 *   Whatever the original fuction returns.
	 */
	bubbleWrap<T>(callback: () => T): T {
		try {
			return callback();
		}
		catch (error) {
			let errorLocation = 'N/A';
			if (hivemind.currentProcess) {
				errorLocation = hivemind.currentProcess.constructor.name;
			}

			let stackTrace = error.stack;
			if (error instanceof Error) {
				stackTrace = _.escape(ErrorMapper.sourceMappedStackTrace(error));
			}
			Game.notify(error.name + ' in ' + errorLocation + ':<br>' + stackTrace);
			console.log('<span style="color:red">' + error.name + ' in ' + errorLocation + ':<br>' + stackTrace + '</span>');
		}

		return null;
	},

	/**
	 * Finds a path using PathFinder.search.
	 *
	 * @param {RoomPosition} startPosition
	 *   Position to start the search from.
	 * @param {object} endPosition
	 *   Position or Positions or object with information about path target.
	 * @param {boolean} allowDanger
	 *   If true, allow traversing unsafe rooms.
	 * @param {object} addOptions
	 *   Options to add to pathfinder options.
	 *
	 * @return {object}
	 *   Result of the pathfinding operation.
	 */
	getPath(startPosition: RoomPosition, endPosition, allowDanger?: boolean, addOptions?: any) {
		const options: PathFinderOpts = {
			plainCost: 2,
			swampCost: 10,
			maxOps: 10000, // The default 2000 can be too little even at a distance of only 2 rooms.

			roomCallback: roomName => {
				// If a room is considered inaccessible, don't look for paths through it.
				if (!(allowDanger || addOptions.allowDanger) && hivemind.segmentMemory.isReady() && getRoomIntel(roomName).isOwned()) {
					if (!addOptions || !addOptions.whiteListRooms || addOptions.whiteListRooms.indexOf(roomName) === -1) {
						return false;
					}
				}

				const options = {
					singleRoom: false,
				};
				if (addOptions && addOptions.singleRoom && addOptions.singleRoom === roomName) {
					options.singleRoom = true;
				}

				// Work with roads and structures in a room.
				const costs = utilities.getCostMatrix(roomName, options);

				// Also try not to drive through bays.
				if (Game.rooms[roomName] && Game.rooms[roomName].roomPlanner) {
					_.each(Game.rooms[roomName].roomPlanner.getLocations('bay_center'), pos => {
						if (costs.get(pos.x, pos.y) <= 20) {
							costs.set(pos.x, pos.y, 20);
						}
					});
				}

				// @todo Try not to drive too close to sources / minerals / controllers.
				// @todo Avoid source keepers.

				return costs;
			},
		};

		if (addOptions) {
			_.each(addOptions, (value, key) => {
				options[key] = value;
			});
		}

		return PathFinder.search(startPosition, endPosition, options);
	},

	/**
	 * Generates a new CostMatrix for pathfinding.
	 *
	 * @param {string} roomName
	 *   Name of the room to generate a cost matrix for.
	 * @param {object} structures
	 *   Arrays of structures to navigate around, keyed by structure type.
	 * @param {object} constructionSites
	 *   Arrays of construction sites to navigate around, keyed by structure type.
	 *
	 * @return {PathFinder.CostMatrix}
	 *   A cost matrix representing the given obstacles.
	 */
	generateCostMatrix(roomName, structures, constructionSites) {
		const costs = new PathFinder.CostMatrix();

		this.markBuildings(
			roomName,
			structures,
			constructionSites,
			structure => {
				if (costs.get(structure.pos.x, structure.pos.y) === 0) {
					costs.set(structure.pos.x, structure.pos.y, 1);
				}
			},
			structure => costs.set(structure.pos.x, structure.pos.y, 0xFF),
			(x, y) => costs.set(x, y, 0xFF),
		);

		return costs;
	},

	/**
	 * Generates an obstacle list as an alternative to cost matrixes.
	 *
	 * @param {string} roomName
	 *   Name of the room to generate an obstacle list for.
	 * @param {object} structures
	 *   Arrays of structures to navigate around, keyed by structure type.
	 * @param {object} constructionSites
	 *   Arrays of construction sites to navigate around, keyed by structure type.
	 *
	 * @return {object}
	 *   An object containing encoded room positions in the following keys:
	 *   - obstacles: Any positions a creep cannot move through.
	 *   - roads: Any positions where a creep travels with road speed.
	 */
	generateObstacleList(roomName, structures, constructionSites) {
		const result = {
			obstacles: [],
			roads: [],
		};

		this.markBuildings(
			roomName,
			structures,
			constructionSites,
			structure => {
				const location = serializeCoords(structure.pos.x, structure.pos.y);
				if (!_.contains(result.obstacles, location)) {
					result.roads.push(location);
				}
			},
			structure => result.obstacles.push(serializePosition(structure.pos, roomName)),
			(x, y) => {
				const location = serializeCoords(x, y);
				if (!_.contains(result.obstacles, location)) {
					result.obstacles.push(location);
				}
			}
		);

		return result;
	},

	/**
	 * Runs code for all given obstacles and roads.
	 *
	 * @param {String} roomName
	 *   Name of the room that's being handled.
	 * @param {object} structures
	 *   Arrays of structures to navigate around, keyed by structure type.
	 * @param {object} constructionSites
	 *   Arrays of construction sites to navigate around, keyed by structure type.
	 * @param {Function} roadCallback
	 *   Gets called for every road found in structures.
	 * @param {Function} blockerCallback
	 *   Gets called for every obstacle found in structures or constructionSites.
	 * @param {Function} sourceKeeperCallback
	 *   Gets called for every position in range of a source keeper.
	 */
	markBuildings(roomName, structures, constructionSites, roadCallback, blockerCallback, sourceKeeperCallback) {
		_.each(OBSTACLE_OBJECT_TYPES, structureType => {
			_.each(structures[structureType], structure => {
				// Can't walk through non-walkable buildings.
				blockerCallback(structure);
			});

			_.each(constructionSites[structureType], site => {
				// Can't walk through non-walkable construction sites.
				blockerCallback(site);
			});
		});

		_.each(structures[STRUCTURE_PORTAL], structure => {
			// Treat portals as blocking. They will be targetted intentionally.
			blockerCallback(structure);
		});

		_.each(structures[STRUCTURE_RAMPART], structure => {
			if (!structure.my) {
				// Enemy ramparts are blocking.
				blockerCallback(structure);
			}
		});

		if (hivemind.segmentMemory.isReady()) {
			const roomIntel = getRoomIntel(roomName);
			if (_.size(structures[STRUCTURE_KEEPER_LAIR]) > 0) {
				// @todo If we're running a (successful) exploit in this room, tiles
				// should not be marked inaccessible.
				// Add area around keeper lairs as obstacles.
				_.each(structures[STRUCTURE_KEEPER_LAIR], structure => {
					utilities.handleMapArea(structure.pos.x, structure.pos.y, (x, y) => {
						sourceKeeperCallback(x, y);
					}, 3);
				});

				// Add area around sources as obstacles.
				_.each(roomIntel.getSourcePositions(), sourceInfo => {
					utilities.handleMapArea(sourceInfo.x, sourceInfo.y, (x, y) => {
						sourceKeeperCallback(x, y);
					}, 4);
				});

				// Add area around mineral as obstacles.
				const mineralInfo = roomIntel.getMineralPosition();
				if (mineralInfo) {
					utilities.handleMapArea(mineralInfo.x, mineralInfo.y, (x, y) => {
						sourceKeeperCallback(x, y);
					}, 4);
				}
			}

			// For exit consistency, we need to check corresponding exit
			// tiles of adjacend rooms, and if blocked by source keepers, block tiles
			// in our own room as well.
			const exits = roomIntel.getExits();
			for (const dir of [TOP, BOTTOM, LEFT, RIGHT]) {
				if (!exits[dir]) continue;

				const otherRoomName = exits[dir];
				const otherRoomIntel = getRoomIntel(otherRoomName);
				if (!otherRoomIntel || !otherRoomIntel.hasCostMatrixData()) continue;

				const matrix = utilities.getCostMatrix(otherRoomName);
				if (dir === TOP || dir === BOTTOM) {
					const y = (dir === TOP ? 0 : 49);
					for (let x = 1; x < 49; x++) {
						if (matrix.get(x, 49 - y) > 100) sourceKeeperCallback(x, y);
					}

					continue;
				}

				const x = (dir === LEFT ? 0 : 49);
				for (let y = 1; y < 49; y++) {
					if (matrix.get(49 - x, y) > 100) sourceKeeperCallback(x, y);
				}
			}
		}

		_.each(structures[STRUCTURE_ROAD], structure => {
			// Favor roads over plain tiles.
			roadCallback(structure);
		});
	},

	/**
	 * Gets the pathfinding cost matrix for a room.
	 *
	 * @param {string} roomName
	 *   Name of the room.
	 * @param {object} options
	 *   Further options regarding the matrix. Can have the following keys:
	 *   - `singleRoom`: If true, return a matrix for creeps that cannot leave
	 *     the room.
	 *
	 * @return {PathFinder.CostMatrix}
	 *   The requested cost matrix.
	 */
	getCostMatrix(roomName, options?: any): CostMatrix {
		if (!options) {
			options = {};
		}

		let cacheKey = 'costMatrix:' + roomName;
		let matrix = hivemind.segmentMemory.isReady() ? cache.inHeap(
			cacheKey,
			500,
			() => {
				const roomIntel = getRoomIntel(roomName);
				return roomIntel.getCostMatrix();
			}
		) : new PathFinder.CostMatrix();

		if (matrix && options.singleRoom && hivemind.segmentMemory.isReady()) {
			// Highly discourage room exits if creep is supposed to stay in a room.
			cacheKey += ':singleRoom';

			matrix = cache.inHeap(
				cacheKey,
				500,
				() => {
					return this.generateSingleRoomCostMatrix(matrix, roomName);
				}
			);
		}

		if (matrix && hivemind.segmentMemory.isReady() && Game.rooms[roomName] && Game.rooms[roomName].isMine()  && Game.rooms[roomName].defense.getEnemyStrength() > 0 && !options.ignoreMilitary) {
			// Discourage unprotected areas when enemies are in the room.
			cacheKey += ':inCombat';

			matrix = cache.inHeap(
				cacheKey,
				20,
				() => {
					return this.generateCombatCostMatrix(matrix, roomName);
				}
			);
		}

		return matrix;
	},

	/**
	 * Generates a derivative cost matrix that highly discourages room exits.
	 *
	 * @param {PathFinder.CostMatrix} matrix
	 *   The matrix to use as a base.
	 * @param {string} roomName
	 *   Name of the room this matrix represents.
	 *
	 * @return {PathFinder.CostMatrix}
	 *   The modified cost matrix.
	 */
	generateSingleRoomCostMatrix(matrix, roomName) {
		const newMatrix = matrix.clone();
		const terrain = new Room.Terrain(roomName);
		for (let i = 1; i < 49; i++) {
			if (terrain.get(i, 0) !== TERRAIN_MASK_WALL) newMatrix.set(i, 0, 50);
			if (terrain.get(0, i) !== TERRAIN_MASK_WALL) newMatrix.set(0, i, 50);
			if (terrain.get(i, 49) !== TERRAIN_MASK_WALL) newMatrix.set(i, 49, 50);
			if (terrain.get(49, i) !== TERRAIN_MASK_WALL) newMatrix.set(49, i, 50);
		}

		return newMatrix;
	},

	/**
	 * Generates a derivative cost matrix that discourages unprotected areas.
	 *
	 * @param {PathFinder.CostMatrix} matrix
	 *   The matrix to use as a base.
	 * @param {string} roomName
	 *   Name of the room this matrix represents.
	 *
	 * @return {PathFinder.CostMatrix}
	 *   The modified cost matrix.
	 */
	generateCombatCostMatrix(matrix, roomName) {
		const newMatrix = matrix.clone();
		const terrain = new Room.Terrain(roomName);

		// We flood fill from enemies and make all tiles they can reach more
		// difficult to travel through.
		const closedList: {[location: string]: boolean} = {};
		const openList: RoomPosition[] = [];

		for (const username in Game.rooms[roomName].enemyCreeps) {
			if (hivemind.relations.isAlly(username)) continue;
			for (const creep of Game.rooms[roomName].enemyCreeps[username]) {
				const location = encodePosition(creep.pos);
				closedList[location] = true;
				openList.push(creep.pos);
			}
		}

		while (openList.length > 0) {
			const pos = openList.pop();

			// Increase cost matrix value for the given tile.
			let value = matrix.get(pos.x, pos.y);
			if (value === 0) {
				value = 1;
				if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_SWAMP) value = 5;
			}

			newMatrix.set(pos.x, pos.y, value + 10);

			// Add available adjacent tiles.
			utilities.handleMapArea(pos.x, pos.y, (x, y,) => {
				if (matrix.get(x, y) > 100) return;
				if (terrain.get(x, y) === TERRAIN_MASK_WALL) return;

				const newPos = new RoomPosition(x, y, roomName);
				const newLocation = encodePosition(newPos);
				if (closedList[newLocation]) return;
				if (Game.rooms[roomName].roomPlanner.isPlannedLocation(newPos, 'rampart')) return;

				closedList[newLocation] = true;
				openList.push(newPos);
			});
		}

		return newMatrix;
	},

	/**
	 * Returns closest target to a room object.
	 *
	 * @param {RoomObject} roomObject
	 *   The room object the search originates from.
	 * @param {RoomObject[]} targets
	 *   A list of room objects to check.
	 *
	 * @return {RoomObject}
	 *   The closest target.
	 */
	getClosest(roomObject, targets) {
		if (targets.length > 0) {
			const target = roomObject.pos.findClosestByRange(targets);
			return target && target.id;
		}
	},

	/**
	 * Gets most highly rated option from a list.
	 *
	 * @param {Array} options
	 *   List of options, each option should at least contain the keys `priority`
	 *   and `weight`.
	 *
	 * @return {object}
	 *   The object with the highest priority and weight (within that priority).
	 */
	getBestOption<T extends {priority: number; weight: number}>(options: T[]): T {
		let best = null;

		for (const option of options) {
			if (option.priority < 0) continue;
			if (!best || option.priority > best.priority || (option.priority === best.priority && option.weight > best.weight)) {
				best = option;
			}
		}

		return best;
	},

	/**
	 * Calculates how much a creep cost to spawn.
	 * @todo Move into Creep.prototype.
	 *
	 * @param {Creep} creep
	 *   The creep in question.
	 *
	 * @return {number}
	 *   Energy cost for this creep.
	 */
	getBodyCost(creep: Creep): number {
		let cost = 0;
		for (const part of creep.body) {
			cost += BODYPART_COST[part.type];
		}

		return cost;
	},

	/**
	 * Get part counts for this creep.
	 * @todo Move into Creep.prototype.
	 *
	 * @param {Creep} creep
	 *   The creep in question.
	 *
	 * @return {object}
	 *   Amount of parts of each type in the creep's body.
	 */
	getBodyParts(creep) {
		return creep.memory.body;
	},

	/**
	 * Runs a function for every tile in range around a given center coordinate.
	 *
	 * @param {number} x
	 *   Center tile's x coordinate.
	 * @param {number} y
	 *   Center tile's y coordinate.
	 * @param {function} callback
	 *   Callback that gets invoked for every tile with x and y coordinates as
	 *   arguments. It may explicitly return false to stop looping through tiles.
	 * @param {number} range
	 *   (Optional) Range around the center to run code for. Defaults to 1.
	 */
	handleMapArea(x: number, y: number, callback: TileCallback, range?: number) {
		if (typeof range === 'undefined') range = 1;
		for (let dx = -range; dx <= range; dx++) {
			if (x + dx < 0) continue;
			if (x + dx >= 50) continue;
			for (let dy = -range; dy <= range; dy++) {
				// Clamp to map boundaries.
				if (y + dy < 0) continue;
				if (y + dy >= 50) continue;
				if (callback(x + dx, y + dy) === false) return;
			}
		}
	},

	/**
	 * Generates lookup table for the ingredients used to crate a compound.
	 *
	 * @return {Object}
	 *   A list of recipe reaction components, keyed by the name of the created
	 *   compound.
	 */
	getReactionRecipes() {
		return cache.inHeap('reverseReactions', 100000, () => {
			const recipes = {};

			_.each(REACTIONS, (reaction, resourceType) => {
				_.each(reaction, (result, resourceType2) => {
					if (recipes[result]) return;

					recipes[result] = [resourceType, resourceType2];
				});
			});

			return recipes;
		});
	},

};

export default utilities;
