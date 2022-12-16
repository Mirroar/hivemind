/* global PathFinder Room RoomPosition LEFT RIGHT TOP BOTTOM
TERRAIN_MASK_WALL STRUCTURE_KEEPER_LAIR */

import cache from 'utils/cache';

import {encodePosition, serializePosition, deserializePosition, serializeCoords} from 'utils/serialization';
import {getCostMatrix} from 'utils/cost-matrix';
import {getRoomIntel} from 'room-intel';
import {handleMapArea} from 'utils/map';

declare global {
	interface Memory {
		nav: NavMemory;
	}
}

interface NavMemory {
	rooms: Record<string, {
		paths: Record<number, Record<number, number>>;
		gen: number;
		exits: Array<{
			id: number;
			center: number;
		}>;
		regions?: Array<{
			exits: number[];
			center: number;
		}>;
	}>;
}

interface ExitInfo {
	id: number;
	center: number;
	vertical: boolean;
	offset: number;
	touched?: boolean;
}

interface RegionInfo {
	exits: number[],
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
	center: number;
}

interface NavMeshPathfindingEntry {
	exitId: number;
	pos: number;
	roomName: string;
	parent: NavMeshPathfindingEntry;
	pathLength: number;
	totalSteps: number;
	heuristic: number;
}

export default class NavMesh {
	memory: NavMemory;
	terrain: RoomTerrain;
	costMatrix: CostMatrix;
	exitLookup: Record<number, ExitInfo>;

	constructor() {
		if (!Memory.nav) {
			Memory.nav = {
				rooms: {},
			};
		}

		this.memory = Memory.nav;
	}

	/**
	 * (Re-)generates nav mesh info for a room.
	 *
	 * @param {String} roomName
	 *   Name of the target room.
	 */
	generateForRoom(roomName: string) {
		// Mesh doesn't need to be updated very often.
		// @todo Allow forcing update for when we dismantle a structure.
		if (this.memory.rooms[roomName] && this.memory.rooms[roomName].paths && !hivemind.hasIntervalPassed(10_000, this.memory.rooms[roomName].gen)) return;

		this.terrain = new Room.Terrain(roomName);
		this.costMatrix = getCostMatrix(roomName).clone();
		const exits = this.getExitInfo();
		const regions = this.getRegions(exits);
		const paths = this.getConnectingPaths(regions, roomName);

		const exitMem: Array<{
			id: number;
			center: number;
		}> = [];
		for (const exit of exits) {
			const centerX = exit.vertical ? exit.offset : exit.center;
			const centerY = exit.vertical ? exit.center : exit.offset;
			exitMem.push({
				id: exit.id,
				center: serializeCoords(centerX, centerY),
			});
		}

		const regionMem: Array<{
			exits: number[];
			center: number;
		}> = [];
		for (const region of regions) {
			const centerX = region.center % 50;
			const centerY = Math.floor(region.center / 50);
			regionMem.push({
				exits: region.exits,
				center: serializeCoords(centerX, centerY),
			});
		}

		this.memory.rooms[roomName] = {
			gen: Game.time,
			exits: exitMem,
			paths,
		};

		if (regions.length > 1) {
			this.memory.rooms[roomName].regions = regionMem;
		}
	}

	/**
	 * Detects groups of exit tiles in a room.
	 *
	 * @return {Object[]}
	 *   An array of exit information objects.
	 */
	getExitInfo(): ExitInfo[] {
		const exits: ExitInfo[] = [];

		this.collectExitGroups(exits, LEFT, true, 0);
		this.collectExitGroups(exits, RIGHT, true, 49);
		this.collectExitGroups(exits, TOP, false, 0);
		this.collectExitGroups(exits, BOTTOM, false, 49);

		return exits;
	}

	collectExitGroups(exits: ExitInfo[], dir: DirectionConstant, vertical: boolean, offset: number) {
		let groupId = 1;

		let currentStart: number = null;
		let nextId = (groupId++) + (10 * (dir - 1));
		for (let i = 1; i < 50; i++) {
			const x = vertical ? offset : i;
			const y = vertical ? i : offset;
			if (this.terrain.get(x, y) === TERRAIN_MASK_WALL || this.costMatrix.get(x, y) > 200) {
				if (currentStart) {
					// Commit end of the current exit group.
					exits.push({
						id: nextId,
						center: Math.floor((i + currentStart) / 2),
						vertical,
						offset,
					});
					currentStart = null;
					nextId = (groupId++) + (10 * (dir - 1));
				}

				continue;
			}

			if (!currentStart) {
				currentStart = i;
			}

			this.costMatrix.set(x, y, nextId + 100);
		}
	}

	getRegions(exits: ExitInfo[]): RegionInfo[] {
		this.exitLookup = {};
		for (const exit of exits) {
			this.exitLookup[exit.id] = exit;
		}

		const regions: RegionInfo[] = [];
		let region: RegionInfo = {
			exits: [],
			minX: 49,
			maxX: 0,
			minY: 49,
			maxY: 0,
			center: null,
		};
		let startPos = this.getUntouchedExit(region, exits);
		let firstRegionTile = startPos;
		while (startPos) {
			const openList = [startPos];

			while (openList.length > 0) {
				const currentPos = openList.pop();

				handleMapArea(currentPos % 50, Math.floor(currentPos / 50), (x, y) => {
					if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;

					const matrixValue = this.costMatrix.get(x, y);
					if (matrixValue > 10) {
						if (matrixValue < 200 && this.exitLookup[matrixValue - 100] && !this.exitLookup[matrixValue - 100].touched) {
							this.exitLookup[matrixValue - 100].touched = true;
							region.exits.push(matrixValue - 100);
						}

						return;
					}

					this.costMatrix.set(x, y, 200 + regions.length);
					openList.push(x + (50 * y));
					if (region.minX > x) region.minX = x;
					if (region.maxX < x) region.maxX = x;
					if (region.minY > y) region.minY = y;
					if (region.maxY < y) region.maxY = y;
				});
			}

			const centerX = Math.floor((region.maxX + region.minX) / 2);
			const centerY = Math.floor((region.maxY + region.minY) / 2);
			// Try to find a tile close to calculated center that is part of the
			// region.
			if (this.costMatrix.get(centerX, centerY) === 200 + regions.length) {
				region.center = centerX + (50 * centerY);
			}

			let range = 1;
			while (!region.center && range < 25) {
				for (const coords of [
					[centerX + range, centerY],
					[centerX - range, centerY],
					[centerX, centerY + range],
					[centerX, centerY - range],
					[centerX + range, centerY + range],
					[centerX + range, centerY - range],
					[centerX - range, centerY + range],
					[centerX - range, centerY - range],
				]) {
					const x = coords[0];
					const y = coords[1];

					if (x < 0 || y < 0 || x > 49 || y > 49) continue;
					if (this.costMatrix.get(x, y) !== 200 + regions.length) continue;

					region.center = x + (50 * y);
					break;
				}

				range++;
			}

			if (!region.center) region.center = firstRegionTile;

			regions.push(region);
			region = {
				exits: [],
				minX: 49,
				maxX: 0,
				minY: 49,
				maxY: 0,
				center: null,
			};
			startPos = this.getUntouchedExit(region, exits);
			firstRegionTile = startPos;
		}

		return regions;
	}

	getUntouchedExit(region: RegionInfo, exits: ExitInfo[]): number {
		for (const exit of exits) {
			if (exit.touched) continue;

			exit.touched = true;
			region.exits.push(exit.id);
			const pos = exit.vertical ? exit.offset + (50 * exit.center) : exit.center + (50 * exit.offset);

			return pos;
		}

		return null;
	}

	getConnectingPaths(regions: RegionInfo[], roomName: string): Record<number, Record<number, number>> {
		const paths: Record<number, Record<number, number>> = {};
		const costMatrix = getCostMatrix(roomName);

		for (const region of regions) {
			const centerXR = region.center % 50;
			const centerYR = Math.floor(region.center / 50);

			for (const exitId of region.exits) {
				const exit = this.exitLookup[exitId];
				const centerX = exit.vertical ? exit.offset : exit.center;
				const centerY = exit.vertical ? exit.center : exit.offset;

				const result = PathFinder.search(
					new RoomPosition(centerX, centerY, roomName),
					new RoomPosition(centerXR, centerYR, roomName),
					{
						roomCallback: () => costMatrix,
						maxRooms: 1,
					},
				);

				if (!result.incomplete) {
					if (!paths[exitId]) paths[exitId] = {};
					paths[exitId][0] = result.path.length;
				}

				for (const exitId2 of region.exits) {
					if (exitId === exitId2) continue;
					if (paths[exitId2] && paths[exitId2][exitId]) continue;

					const exit2 = this.exitLookup[exitId2];
					const centerX2 = exit2.vertical ? exit2.offset : exit2.center;
					const centerY2 = exit2.vertical ? exit2.center : exit2.offset;

					const result = PathFinder.search(
						new RoomPosition(centerX, centerY, roomName),
						new RoomPosition(centerX2, centerY2, roomName),
						{
							roomCallback: () => costMatrix,
							maxRooms: 1,
						},
					);

					if (!result.incomplete) {
						if (!paths[exitId]) paths[exitId] = {};
						paths[exitId][exitId2] = result.path.length;
					}
				}
			}
		}

		return paths;
	}

	estimateTravelTime(startPos: RoomPosition, endPos: RoomPosition): number {
		return cache.inHeap('travelTime:' + encodePosition(startPos) + ':' + encodePosition(endPos), 1000, () => {
			const result = this.findPath(startPos, endPos);
			if (result.incomplete) return null;

			return result.length;
		});
	}

	findPath(startPos: RoomPosition, endPos: RoomPosition, options?: {maxPathLength?: number, allowDanger?: boolean}): {path?: RoomPosition[]; length?: number; incomplete: boolean} {
		if (!options) options = {};

		const startRoom = startPos.roomName;
		const endRoom = endPos.roomName;
		let availableExits: Array<{
			id: number;
			center: number;
		}> = [];
		const openList: NavMeshPathfindingEntry[] = [];
		const openListLookup: Record<string, boolean> = {};
		const closedList: Record<string, boolean> = {};
		if (!this.memory.rooms[startRoom]) {
			// Trying to find a path outside of nav mesh. We can't really decide.
			return {
				incomplete: true,
			};
		}

		const roomMemory = this.memory.rooms[startRoom];
		if (roomMemory.regions) {
			const costMatrix = getCostMatrix(startRoom);
			for (const region of roomMemory.regions) {
				// Check if we can reach region center.
				const result = PathFinder.search(
					startPos,
					deserializePosition(region.center, startRoom),
					{
						roomCallback: () => costMatrix,
						maxRooms: 1,
					},
				);

				if (result.incomplete) continue;

				// Exits for this region are available.
				availableExits = _.filter(roomMemory.exits, exit => region.exits.includes(exit.id));
			}
		}
		else {
			availableExits = roomMemory.exits;
		}

		for (const exit of availableExits) {
			const segmentLength = roomMemory.paths[exit.id] ? roomMemory.paths[exit.id][0] : 50;
			const entry: NavMeshPathfindingEntry = {
				exitId: exit.id,
				pos: exit.center,
				roomName: startRoom,
				parent: null,
				pathLength: segmentLength,
				totalSteps: segmentLength,
				heuristic: (Game.map.getRoomLinearDistance(startRoom, endRoom) - 1) * 50,
			};
			openList.push(entry);
			openListLookup[startRoom + '/' + exit.center] = true;
		}

		while (openList.length > 0) {
			const current = this.popBestCandidate(openList);
			const nextRoom = this.getAdjacentRoom(current.roomName, current.exitId);
			const correspondingExit = this.getCorrespondingExitId(current.exitId);
			let costMultiplier = 1;
			closedList[current.roomName + '/' + current.pos] = true;

			if (current.roomName === endRoom) {
				// @todo There might be shorter paths to the actual endPosition.
				// @todo Check if we came out in the correct region.

				// Alright, we arrived! Get final path.
				return {
					path: this.pluckRoomPath(current),
					length: current.totalSteps,
					incomplete: false,
				};
			}

			if (options.maxPathLength && current.pathLength >= options.maxPathLength) {
				continue;
			}

			const roomMemory = this.memory.rooms[nextRoom];
			if (!roomMemory) {
				// @todo Fallback to basic exit info? Or generate nav mesh on the fly
				// without structure info?
				continue;
			}

			if (roomMemory.exits[correspondingExit]) {
				const exitPos = roomMemory.exits[correspondingExit].center;
				if (closedList[exitPos]) continue;

				closedList[nextRoom + '/' + exitPos] = true;
			}

			if (hivemind.segmentMemory.isReady()) {
				const roomIntel = getRoomIntel(nextRoom);
				if (roomIntel.isOwned()) {
					if (!options.allowDanger && !hivemind.relations.isAlly(roomIntel.getOwner())) continue;

					costMultiplier *= 5;
				}
				else if (roomIntel.isClaimed()) {
					costMultiplier *= 1.5;
				}

				if (_.size(roomIntel.getStructures(STRUCTURE_KEEPER_LAIR)) > 0) {
					// Allow pathing through source keeper rooms since we can safely avoid them.
					costMultiplier *= 2;
				}
			}

			availableExits = [];
			if (roomMemory.regions) {
				// Find region containing corresponding exit.
				const region = _.find(roomMemory.regions, (region: any) => region.exits.includes(correspondingExit));
				if (!region) continue;

				availableExits = _.filter(roomMemory.exits, exit => exit.id !== correspondingExit && region.exits.includes(exit.id));
			}
			else {
				availableExits = _.filter(roomMemory.exits, exit => exit.id !== correspondingExit);
			}

			for (const exit of availableExits) {
				// Check if in closed list.
				if (closedList[nextRoom + '/' + exit.center]) continue;
				if (openListLookup[nextRoom + '/' + exit.center]) continue;

				// If there's a weird path mismatch, skip.
				const noPath1 = !roomMemory.paths[exit.id] || !roomMemory.paths[exit.id][correspondingExit];
				const noPath2 = !roomMemory.paths[correspondingExit] || !roomMemory.paths[correspondingExit][exit.id];
				if (noPath1 && noPath2) continue;

				const segmentLength = (roomMemory.paths[exit.id] && roomMemory.paths[exit.id][correspondingExit]) || roomMemory.paths[correspondingExit][exit.id];
				const item = {
					exitId: exit.id,
					pos: exit.center,
					roomName: nextRoom,
					parent: current,
					pathLength: current.pathLength + (costMultiplier * segmentLength),
					totalSteps: current.totalSteps + segmentLength,
					heuristic: (Game.map.getRoomLinearDistance(current.roomName, endRoom) - 1) * 50,
				};

				if (nextRoom === endRoom) {
					item.pos = serializeCoords(endPos.x, endPos.y);
					item.heuristic = 0;
					item.pathLength = current.pathLength + roomMemory.paths[correspondingExit][0];
					item.totalSteps = current.totalSteps + roomMemory.paths[correspondingExit][0];
				}

				openList.push(item);
				openListLookup[nextRoom + '/' + exit.center] = true;
				openListLookup[nextRoom + '/' + item.pos] = true;
			}
		}

		// No solution using nav mesh. Try normal pathfinding?
		// @todo Include path that gets us closest?
		return {
			incomplete: true,
		};
	}

	popBestCandidate(openList: NavMeshPathfindingEntry[]): NavMeshPathfindingEntry {
		// Find element id with lowest pathLength + heuristic.
		let minId = null;
		let minDist = 0;
		for (let i = 0; i < openList.length; i++) {
			if (minId === null || minDist > (openList[i].pathLength + openList[i].heuristic)) {
				minId = i;
				minDist = openList[i].pathLength + openList[i].heuristic;
			}
		}

		if (minId < openList.length - 1) {
			// Swap min element to end of array.
			const temporary = openList[openList.length - 1];
			openList[openList.length - 1] = openList[minId];
			openList[minId] = temporary;
		}

		return openList.pop();
	}

	getAdjacentRoom(roomName: string, exitId: number): string {
		// @todo Use RoomIntel.getExits() or Game.map.describeExits() instead.
		const parts = roomName.match(/(\w)(\d+)(\w)(\d+)/);

		const dir = Math.floor(exitId / 20);
		switch (dir) {
			case 0:
				// Exit is due north.
				if (parts[3] === 'N') {
					return parts[1] + parts[2] + parts[3] + (Number.parseInt(parts[4], 10) + 1);
				}

				if (parts[4] === '1') {
					return parts[1] + parts[2] + 'N1';
				}

				return parts[1] + parts[2] + parts[3] + (Number.parseInt(parts[4], 10) - 1);

			case 1:
				// Exit is due east.
				if (parts[1] === 'E') {
					return parts[1] + (Number.parseInt(parts[2], 10) + 1) + parts[3] + parts[4];
				}

				if (parts[2] === '1') {
					return 'E1' + parts[3] + parts[4];
				}

				return parts[1] + (Number.parseInt(parts[2], 10) - 1) + parts[3] + parts[4];

			case 2:
				// Exit is due south.
				if (parts[3] === 'S') {
					return parts[1] + parts[2] + parts[3] + (Number.parseInt(parts[4], 10) + 1);
				}

				if (parts[4] === '1') {
					return parts[1] + parts[2] + 'S1';
				}

				return parts[1] + parts[2] + parts[3] + (Number.parseInt(parts[4], 10) - 1);

			default:
				// Exit is due west.
				if (parts[1] === 'W') {
					return parts[1] + (Number.parseInt(parts[2], 10) + 1) + parts[3] + parts[4];
				}

				if (parts[2] === '1') {
					return 'W1' + parts[3] + parts[4];
				}

				return parts[1] + (Number.parseInt(parts[2], 10) - 1) + parts[3] + parts[4];
		}
	}

	getCorrespondingExitId(exitId: number): number {
		return (exitId + 40) % 80;
	}

	pluckRoomPath(current: NavMeshPathfindingEntry): RoomPosition[] {
		const path = [deserializePosition(current.pos, current.roomName)];
		while (current.parent) {
			current = current.parent;
			path.push(deserializePosition(current.pos, current.roomName));
		}

		return path.reverse();
	}
}
