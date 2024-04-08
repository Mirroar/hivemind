/* global PathFinder Room RoomPosition LEFT RIGHT TOP BOTTOM
TERRAIN_MASK_WALL STRUCTURE_KEEPER_LAIR */

import cache from 'utils/cache';
import hivemind from 'hivemind';
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
		portals?: Array<{
			room: string;
			pos: number;
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
	exits: number[];
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
	portal: boolean;
	targetRoom?: string;
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
		if (
			this.memory.rooms[roomName]
			&& this.memory.rooms[roomName].paths
			&& !hivemind.hasIntervalPassed(10_000, this.memory.rooms[roomName].gen)
		) return;

		this.terrain = new Room.Terrain(roomName);
		this.costMatrix = getCostMatrix(roomName, {ignoreMilitary: true}).clone();
		const exits = this.getExitInfo(roomName);
		const regions = this.getRegions(exits);
		const paths = this.getConnectingPaths(regions, roomName);
		// @todo If we want to be really specific, we should have the portals
		// separated by regions.
		const portals = this.getPortals(roomName);

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
			portals,
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
	getExitInfo(roomName: string): ExitInfo[] {
		const exits: ExitInfo[] = [];

		this.collectExitGroups(roomName, exits, LEFT, true, 0);
		this.collectExitGroups(roomName, exits, RIGHT, true, 49);
		this.collectExitGroups(roomName, exits, TOP, false, 0);
		this.collectExitGroups(roomName, exits, BOTTOM, false, 49);

		return exits;
	}

	collectExitGroups(roomName: string, exits: ExitInfo[], dir: DirectionConstant, vertical: boolean, offset: number) {
		const isAvailable = this.isAvailableExitDirection(roomName, dir);
		let groupId = 1;
		let currentStart: number = null;
		let nextId = (groupId++) + (10 * (dir - 1));
		for (let i = 1; i < 50; i++) {
			const x = vertical ? offset : i;
			const y = vertical ? i : offset;
			if (this.terrain.get(x, y) === TERRAIN_MASK_WALL || this.costMatrix.get(x, y) > 200) {
				if (currentStart && isAvailable) {
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

			this.costMatrix.set(x, y, isAvailable ? (nextId + 100) : 255);
		}
	}

	isAvailableExitDirection(roomName: string, dir: DirectionConstant): boolean {
		const otherRoomName = Game.map.describeExits(roomName)[dir];
		if (!otherRoomName) return false;

		return Game.map.getRoomStatus(otherRoomName).status === Game.map.getRoomStatus(roomName).status;
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
		const costMatrix = getCostMatrix(roomName, {ignoreMilitary: true});

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

	getPortals(roomName: string) {
		let portals: Record<string, {
			targetRoom: string;
			positions: RoomPosition[];
			totalX: number;
			totalY: number;
		}> = {};

		const room = Game.rooms[roomName];
		for (const portal of room.structuresByType[STRUCTURE_PORTAL] || []) {
			if ('shard' in portal.destination) continue;
			if (this.isPortalBlocked(room, portal.pos)) continue;

			if (!portals[portal.destination.roomName]) {
				portals[portal.destination.roomName] = {
					targetRoom: portal.destination.roomName,
					positions: [portal.pos],
					totalX: portal.pos.x,
					totalY: portal.pos.y,
				};
				continue;
			}

			portals[portal.destination.roomName].positions.push(portal.pos);
			portals[portal.destination.roomName].totalX += portal.pos.x;
			portals[portal.destination.roomName].totalY += portal.pos.y;
		}

		if (_.size(portals) === 0) return undefined;

		return _.map(portals, portal => {
			const pos = _.min(portal.positions, pos => pos.getRangeTo(
				Math.round(portal.totalX / portal.positions.length),
				Math.round(portal.totalY / portal.positions.length),
			));

			return {
				room: portal.targetRoom,
				pos: pos.x + (50 * pos.y),
			}
		});
	}

	isPortalBlocked(room: Room, pos: RoomPosition): boolean {
		let hasFreeSpace = false;
		this.terrain

		handleMapArea(pos.x, pos.y, (x, y) => {
			if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;
			if (this.costMatrix.get(x, y) >= 100) return;

			hasFreeSpace = true;
		});

		return hasFreeSpace;
	}

	estimateTravelTime(startPos: RoomPosition, endPos: RoomPosition): number {
		return cache.inHeap('travelTime:' + encodePosition(startPos) + ':' + encodePosition(endPos), 1000, () => {
			const result = this.findPath(startPos, endPos);
			if (result.incomplete) return null;

			return result.length;
		});
	}

	findPath(startPos: RoomPosition, endPos: RoomPosition, options?: {maxPathLength?: number; allowDanger?: boolean, maxCpu?: number}): {
		path?: RoomPosition[];
		length?: number;
		incomplete: boolean;
	} {
		if (!options) options = {};

		const startTime = Game.cpu.getUsed();
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
			const costMatrix = getCostMatrix(startRoom, {ignoreMilitary: true});
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
				portal: false,
			};
			openList.push(entry);
			openListLookup[startRoom + '/' + entry.pos] = true;
		}

		for (const portal of roomMemory.portals || []) {
			const entry: NavMeshPathfindingEntry = {
				exitId: null,
				pos: portal.pos,
				roomName: startRoom,
				parent: null,
				pathLength: 25,
				totalSteps: 25,
				heuristic: (Game.map.getRoomLinearDistance(startRoom, endRoom) - 1) * 50,
				portal: true,
				targetRoom: portal.room,
			};
			openList.push(entry);
			openListLookup[startRoom + '/' + entry.pos] = true;
		}

		while (openList.length > 0) {
			if (Game.cpu.getUsed() - startTime > (options.maxCpu || 5)) {
				// Used too much CPU for finding a path. abort.
				return {
					incomplete: true,
				};
			}

			const current = this.popBestCandidate(openList);
			const nextRoom = current.portal ? current.targetRoom : this.getAdjacentRoom(current.roomName, current.exitId);
			const correspondingExit = current.portal ? null : this.getCorrespondingExitId(current.exitId);
			let costMultiplier = 1;
			closedList[current.roomName + '/' + current.pos] = true;

			if (nextRoom === endRoom) {
				// @todo There might be shorter paths to the actual endPosition.
				// @todo Check if we came out in the correct region.

				// Alright, we arrived! Get final path.
				return {
					path: [...this.pluckRoomPath(current), endPos],
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

			if (current.portal) {
				const portalBack = _.find(roomMemory.portals, p => p.room === current.roomName);
				const exitPos = portalBack ? portalBack.pos : (25 + (50 * 25));
				if (closedList[nextRoom + '/' + exitPos]) continue;

				closedList[nextRoom + '/' + exitPos] = true;
			}
			else if (roomMemory.exits[correspondingExit]) {
				const exitPos = roomMemory.exits[correspondingExit].center;
				if (closedList[nextRoom + '/' + exitPos]) continue;

				closedList[nextRoom + '/' + exitPos] = true;
			}

			if (hivemind.segmentMemory.isReady()) {
				const roomIntel = getRoomIntel(nextRoom);
				if (roomIntel.isOwned()) {
					if (!options.allowDanger && !hivemind.relations.isAlly(roomIntel.getOwner())) continue;

					costMultiplier *= 5;
				}
				else if (roomIntel.isClaimed() && roomIntel.getReservationStatus().username !== 'Invader') {
					costMultiplier *= 1.5;
				}
				else if (_.size(roomIntel.getStructures(STRUCTURE_KEEPER_LAIR)) > 0) {
					// Allow pathing through source keeper rooms since we can safely avoid them.
					costMultiplier *= 1.2;
				}
			}

			if (Memory.rooms[nextRoom]?.enemies && !Memory.rooms[nextRoom]?.enemies?.safe && !options.allowDanger) {
				// Avoid rooms with enemies in them if possible.
				costMultiplier *= 2;
			}

			availableExits = [];
			if (current.portal) {
				availableExits = roomMemory.exits;
			}
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

				if (!current.portal) {
					// If there's a weird path mismatch, skip.
					const noPath1 = !roomMemory.paths[exit.id] || !roomMemory.paths[exit.id][correspondingExit];
					const noPath2 = !roomMemory.paths[correspondingExit] || !roomMemory.paths[correspondingExit][exit.id];
					if (noPath1 && noPath2) continue;
				}

				const segmentLength = current.portal ? 25 : (roomMemory.paths[exit.id] && roomMemory.paths[exit.id][correspondingExit]) || roomMemory.paths[correspondingExit][exit.id];
				const item = {
					exitId: exit.id,
					pos: exit.center,
					roomName: nextRoom,
					parent: current,
					pathLength: current.pathLength + (costMultiplier * segmentLength),
					totalSteps: current.totalSteps + segmentLength,
					heuristic: (Game.map.getRoomLinearDistance(nextRoom, endRoom) - 1) * 50,
					portal: false,
				};

				if (nextRoom === endRoom) {
					item.pos = serializeCoords(endPos.x, endPos.y);
					item.heuristic = 0;
					item.pathLength = current.pathLength + (costMultiplier * (current.portal ? 25 : roomMemory.paths[correspondingExit][0]));
					item.totalSteps = current.totalSteps + (current.portal ? 25 : roomMemory.paths[correspondingExit][0]);
				}

				openList.push(item);
				openListLookup[nextRoom + '/' + exit.center] = true;
				openListLookup[nextRoom + '/' + item.pos] = true;
			}

			for (const portal of roomMemory.portals || []) {
				// Check if in closed list.
				if (closedList[nextRoom + '/' + portal.pos]) continue;
				if (openListLookup[nextRoom + '/' + portal.pos]) continue;

				const item = {
					exitId: null,
					pos: portal.pos,
					roomName: nextRoom,
					parent: current,
					pathLength: current.pathLength + (costMultiplier * 25),
					totalSteps: current.totalSteps + 25,
					heuristic: (Game.map.getRoomLinearDistance(nextRoom, endRoom) - 1) * 50,
					portal: true,
					targetRoom: portal.room,
				};

				if (nextRoom === endRoom) {
					item.pos = serializeCoords(endPos.x, endPos.y);
					item.heuristic = 0;
				}

				openList.push(item);
				openListLookup[nextRoom + '/' + item.pos] = true;
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
		for (const [i, element] of openList.entries()) {
			if (minId === null || minDist > (element.pathLength + element.heuristic)) {
				minId = i;
				minDist = element.pathLength + element.heuristic;
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
		const parts = /(\w)(\d+)(\w)(\d+)/.exec(roomName);

		const dir = Math.floor(exitId / 20);
		switch (dir) {
			case 0:
				// Exit is due north.
				if (parts[3] === 'N') {
					return parts[1] + parts[2] + parts[3] + (Number.parseInt(parts[4], 10) + 1);
				}

				if (parts[4] === '0') {
					return parts[1] + parts[2] + 'N0';
				}

				return parts[1] + parts[2] + parts[3] + (Number.parseInt(parts[4], 10) - 1);

			case 1:
				// Exit is due east.
				if (parts[1] === 'E') {
					return parts[1] + (Number.parseInt(parts[2], 10) + 1) + parts[3] + parts[4];
				}

				if (parts[2] === '0') {
					return 'E0' + parts[3] + parts[4];
				}

				return parts[1] + (Number.parseInt(parts[2], 10) - 1) + parts[3] + parts[4];

			case 2:
				// Exit is due south.
				if (parts[3] === 'S') {
					return parts[1] + parts[2] + parts[3] + (Number.parseInt(parts[4], 10) + 1);
				}

				if (parts[4] === '0') {
					return parts[1] + parts[2] + 'S0';
				}

				return parts[1] + parts[2] + parts[3] + (Number.parseInt(parts[4], 10) - 1);

			default:
				// Exit is due west.
				if (parts[1] === 'W') {
					return parts[1] + (Number.parseInt(parts[2], 10) + 1) + parts[3] + parts[4];
				}

				if (parts[2] === '0') {
					return 'W0' + parts[3] + parts[4];
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
