/* global hivemind PathFinder Room RoomPosition TERRAIN_MASK_WALL REACTIONS
STRUCTURE_RAMPART STRUCTURE_ROAD BODYPART_COST
TOP TOP_RIGHT RIGHT BOTTOM_RIGHT BOTTOM BOTTOM_LEFT LEFT TOP_LEFT
STRUCTURE_PORTAL STRUCTURE_KEEPER_LAIR */

import cache from 'utils/cache';
import hivemind from 'hivemind';
import {ErrorMapper} from 'utils/ErrorMapper';
import {getCostMatrix} from 'utils/cost-matrix';
import {getRoomIntel} from 'room-intel';

declare global {
	type TileCallback = (x: number, y: number) => boolean | void;

	interface WeightedOption {
		priority: number;
		weight: number;
	}

	namespace NodeJS {
		interface Global {
			utilities: typeof utilities;
		}
	}
}

const utilities = {

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
	getPath(startPosition: RoomPosition, endPosition, allowDanger = false, addOptions: {isQuad?: boolean; allowDanger?: boolean; whiteListRooms?: string[]; singleRoom?: string} = {}) {
		const options: PathFinderOpts = {
			plainCost: 2,
			swampCost: 10,
			maxOps: 10_000, // The default 2000 can be too little even at a distance of only 2 rooms.

			roomCallback: roomName => {
				// If a room is considered inaccessible, don't look for paths through it.
				if (!(allowDanger || addOptions.allowDanger) && hivemind.segmentMemory.isReady() && getRoomIntel(roomName).isOwned() && (!addOptions.whiteListRooms || !addOptions.whiteListRooms.includes(roomName))) {
					return false;
				}

				const options = {
					singleRoom: false,
					isQuad: false,
				};
				if (addOptions.singleRoom && addOptions.singleRoom === roomName) {
					options.singleRoom = true;
				}

				if (addOptions.isQuad) {
					options.isQuad = true;
				}

				// Work with roads and structures in a room.
				const costs = getCostMatrix(roomName, options);

				return costs;
			},
		};

		_.each(addOptions, (value, key) => {
			options[key] = value;
		});

		return PathFinder.search(startPosition, endPosition, options);
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
	getBestOption<T extends WeightedOption>(options: T[]): T {
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
	 * Generates lookup table for the ingredients used to create a compound.
	 *
	 * @return {Object}
	 *   A list of recipe reaction components, keyed by the name of the created
	 *   compound.
	 */
	getReactionRecipes(): Partial<Record<ResourceConstant, ResourceConstant[]>> {
		// @todo Include factory recipes, since this method is used to calculate
		// the value of trade commodities.
		return cache.inHeap('reverseReactions', 100_000, () => {
			const recipes: Partial<Record<ResourceConstant, ResourceConstant[]>> = {};

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
global.utilities = utilities;
