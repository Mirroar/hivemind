/* global TERRAIN_MASK_WALL */

/**
 * Code for calculating the minCut in a room.
 * Based on code written by Saruss and adapted by Chobobobo.
 *
 * Refactored and cleaned up by Mirroar.
 */

declare global {
	interface MinCutRect {
		x1: number;
		y1: number;
		x2: number;
		y2: number;
		protectTopExits?: boolean;
		protectBottomExits?: boolean;
		protectLeftExits?: boolean;
		protectRightExits?: boolean;
	}
}

const UNWALKABLE = -1;
const NORMAL = 0;
const PROTECTED = 1;
const TO_EXIT = 2;
const EXIT = 3;

const infinity = Number.MAX_VALUE;
const surroundingTiles = [
	[0, -1],
	[-1, -1],
	[-1, 0],
	[-1, 1],
	[0, 1],
	[1, 1],
	[1, 0],
	[1, -1],
];
const roomCorners = [
	[[1, 1], [1, 2], [2, 1]],
	[[48, 1], [48, 2], [47, 1]],
	[[1, 48], [1, 47], [2, 48]],
	[[48, 48], [48, 47], [47, 48]],
];

/**
 * Generates an array representation of room terrain.
 *
 * @param {string} roomName
 *   Name of the room for which to use terrain data.
 * @param {object} bounds
 *   Bounds of the room.
 *
 * @todo Check if bounds parameter makes any sense.
 */
function generateRoomTerrainArray(roomName: string, bounds?: MinCutRect) {
	if (!bounds) bounds = {x1: 0, y1: 0, x2: 49, y2: 49};

	// Create two dimensional array of room tiles.
	const roomArray = Array.from({length: 50}).fill(0).map(() => Array.from({length: 50}).fill(UNWALKABLE)) as number[][];

	const terrain = Game.map.getRoomTerrain(roomName);
	for (let x = bounds.x1; x <= bounds.x2; x++) {
		for (let y = bounds.y1; y <= bounds.y2; y++) {
			if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
				roomArray[x][y] = NORMAL;

				if (x === 0 || y === 0 || x === 49 || y === 49) {
					// Mark exit tiles.
					roomArray[x][y] = EXIT;
				}
			}
		}
	}

	// Mark tiles near exits as sinks - walls / ramparts may not be built there.
	for (let y = 1; y < 49; y++) {
		if (
			roomArray[0][y - 1] === EXIT
			|| roomArray[0][y] === EXIT
			|| roomArray[0][y + 1] === EXIT
		) {
			roomArray[1][y] = TO_EXIT;
		}

		if (
			roomArray[49][y - 1] === EXIT
			|| roomArray[49][y] === EXIT
			|| roomArray[49][y + 1] === EXIT
		) {
			roomArray[48][y] = TO_EXIT;
		}
	}

	for (let x = 1; x < 49; x++) {
		if (
			roomArray[x - 1][0] === EXIT
			|| roomArray[x][0] === EXIT
			|| roomArray[x + 1][0] === EXIT
		) {
			roomArray[x][1] = TO_EXIT;
		}

		if (
			roomArray[x - 1][49] === EXIT
			|| roomArray[x][49] === EXIT
			|| roomArray[x + 1][49] === EXIT
		) {
			roomArray[x][48] = TO_EXIT;
		}
	}

	addProtectedExitsToRoomArray(roomArray, bounds);
	modifyProblematicProtectedExits(roomArray);

	// Mark border tiles as not usable.
	for (let y = 1; y < 49; y++) {
		roomArray[0][y] = UNWALKABLE;
		roomArray[49][y] = UNWALKABLE;
	}

	for (let x = 1; x < 49; x++) {
		roomArray[x][0] = UNWALKABLE;
		roomArray[x][49] = UNWALKABLE;
	}

	return roomArray;
}

let protectedExitTiles: Record<string, boolean>;

/**
 * Marks protected exits.
 */
function addProtectedExitsToRoomArray(roomArray: number[][], bounds: MinCutRect) {
	protectedExitTiles = {};

	for (let i = 1; i < 49; i++) {
		if (bounds.protectTopExits) protectExitTile(roomArray, i, 1);
		if (bounds.protectBottomExits) protectExitTile(roomArray, i, 48);
		if (bounds.protectLeftExits) protectExitTile(roomArray, 1, i);
		if (bounds.protectRightExits) protectExitTile(roomArray, 48, i);
	}
}

function protectExitTile(roomArray: number[][], x: number, y: number) {
	if (roomArray[x][y] !== TO_EXIT) return;

	roomArray[x][y] = PROTECTED;
	protectedExitTiles[x + (50 * y)] = true;
	for (const [dx, dy] of surroundingTiles) {
		if (roomArray[x + dx][y + dy] !== NORMAL) continue;
		roomArray[x + dx][y + dy] = PROTECTED;
	}
}

/**
 * Unprotects exits where it's impossible to build ramparts in corners.
 *
 * @example shard0/E45S62.
 */
function modifyProblematicProtectedExits(roomArray: number[][]) {
	for (const corner of roomCorners) {
		let hasProtectedTile = false;
		let hasForbiddenTile = false;

		for (const coords of corner) {
			if (roomArray[coords[0]][coords[1]] === PROTECTED) hasProtectedTile = true;
			if (roomArray[coords[0]][coords[1]] === TO_EXIT) hasForbiddenTile = true;
		}

		if (hasForbiddenTile && hasProtectedTile) {
			floodFillUnprotectedExit(roomArray, corner);
		}
	}
}

function floodFillUnprotectedExit(roomArray: number[][], corner: number[][]) {
	const queue: number[][] = [];
	for (const [x, y] of corner) {
		if (roomArray[x][y] === PROTECTED) queue.push([x, y]);
	}

	while (queue.length > 0) {
		const [x, y] = queue.splice(0, 1)[0];
		if (roomArray[x][y] === PROTECTED) {
			roomArray[x][y] = protectedExitTiles[x + (50 * y)] ? TO_EXIT : NORMAL;
			for (const [dx, dy] of surroundingTiles) {
				if (roomArray[x + dx][y + dy] === PROTECTED) {
					queue.push([x + dx, y + dy]);
				}
			}
		}
	}
}

/**
 * @todo Documentation
 */
class Graph {
	v: number;
	level: number[];
	edges: Array<Array<{
		v: number;
		r: number;
		c: number;
		f: number;
		u?: number;
	}>>;

	/**
	 * @todo Documentation
	 */
	constructor(vertexCount: number) {
		this.v = vertexCount;
		this.level = Array.from({length: vertexCount});
		// Array: for every vertex an edge Array with {v, r, c, f} vertex_to, res_edge, capacity, flow
		this.edges = Array.from({length: vertexCount}).fill(0).map(() => []);
	}

	/**
	 * Adds new edge from u to v.
	 */
	addEdge(u, v, c) {
		// Normal forward edge
		this.edges[u].push({
			v,
			r: this.edges[v].length,
			c,
			f: 0,
		});
		// Reverse edge for Residal Graph
		this.edges[v].push({
			v: u,
			r: this.edges[u].length - 1,
			c: 0,
			f: 0,
		});
	}

	/**
	 * Calculates Level Graph and if theres a path from s to t
	 */
	pathExistsBetween(s, t): boolean {
		if (t >= this.v) return false;

		// Reset old levels.
		this.level.fill(-1);
		this.level[s] = 0;

		// Queue with s as starting point.
		const queue = [];
		queue.push(s);

		let u = 0;
		let edge = null;
		while (queue.length > 0) {
			u = queue.splice(0, 1)[0];
			for (let i = 0; i < this.edges[u].length; i++) {
				edge = this.edges[u][i];
				if (this.level[edge.v] < 0 && edge.f < edge.c) {
					this.level[edge.v] = this.level[u] + 1;
					queue.push(edge.v);
				}
			}
		}

		// Return if theres a path to t -> no level, no path!
		return this.level[t] >= 0;
	}

	// DFS like: send flow at along path from s->t recursivly while increasing the level of the visited vertices by one
	// u vertex, f flow on path, t =Sink , c Array, c[i] saves the count of edges explored from vertex i
	accumulateFlow(u, f, t, c) {
		// Abort recursion if sink has been reached.
		if (u === t) return f;

		let accumulatedFlow = 0;
		let flowToSink = 0;
		while (c[u] < this.edges[u].length) {
			// Visit all edges of the vertex one after the other
			const edge = this.edges[u][c[u]];
			if (this.level[edge.v] === this.level[u] + 1 && edge.f < edge.c) {
				// Edge leads to Vertex with a level one higher, and has flow left.
				accumulatedFlow = Math.min(f, edge.c - edge.f);
				flowToSink = this.accumulateFlow(edge.v, accumulatedFlow, t, c);
				if (flowToSink > 0) {
					// Add Flow to current edge
					edge.f += flowToSink;

					// Substract from reverse Edge -> Residual Graph neg. Flow to use backward direction of pathExistsBetween/DFS
					this.edges[edge.v][edge.r].f -= flowToSink;
					return flowToSink;
				}
			}

			c[u]++;
		}

		return 0;
	}

	/**
	 * Breadth-first-search which uses the level array to mark the vertices reachable from s
	 */
	markReachableVertices(s: number) {
		const edgesInCut = [];

		this.level.fill(-1);
		this.level[s] = 1;

		const queue: number[] = [];
		queue.push(s);
		while (queue.length > 0) {
			const u = queue.splice(0, 1)[0];
			for (let i = 0; i < this.edges[u].length; i++) {
				const edge = this.edges[u][i];
				if (edge.f < edge.c && this.level[edge.v] < 1) {
					this.level[edge.v] = 1;
					queue.push(edge.v);
				}

				if (edge.f === edge.c && edge.c > 0) {
					// Blocking edge -> could be in min cut.
					edge.u = u;
					edgesInCut.push(edge);
				}
			}
		}

		const minCut = [];
		for (const edge of edgesInCut) {
			if (this.level[edge.v] === -1) {
				// Only edges which are blocking and lead to from s unreachable vertices are in the min cut.
				minCut.push(edge.u);
			}
		}

		return minCut;
	}

	/**
	 * Calculates min-cut graph (Dinic Algorithm)
	 */
	calculateMinCut(s, t) {
		if (s === t) return -1;

		let totalFlow = 0;
		while (this.pathExistsBetween(s, t)) {
			const count = new Array(this.v + 1).fill(0);
			let flow = 0;
			do {
				flow = this.accumulateFlow(s, infinity, t, count);
				if (flow > 0) totalFlow += flow;
			} while (flow);
		}

		return totalFlow;
	}
}

const minCutInterface = {
	// Function to create Source, Sink, Tiles arrays: takes a rectangle-Array as input for Tiles that are to Protect
	// rects have top-left/bot_right Coordinates {x1,y1,x2,y2}
	createGraph(roomName, rect, bounds) {
		const roomTerrain = generateRoomTerrainArray(roomName, bounds);

		// For all Rectangles, set edges as source (to protect area) and area as unused
		// Check bounds
		if (bounds.x1 >= bounds.x2 || bounds.y1 >= bounds.y2 || bounds.x1 < 0 || bounds.y1 < 0 || bounds.x2 > 49 || bounds.y2 > 49) {
			console.log('ERROR: Invalid bounds:', JSON.stringify(bounds));
			return null;
		}

		for (const [j, r] of rect.entries()) {
			// Test sizes of rectangles
			if (r.x1 > r.x2 || r.y1 > r.y2) {
				console.log('ERROR: Rectangle nr.', j, JSON.stringify(r), 'is invalid.');
				continue;
			}

			if (r.x1 < bounds.x1 || r.x2 > bounds.x2 || r.y1 < bounds.y1 || r.y2 > bounds.y2) {
				console.log('ERROR: Rectangle nr.', j, JSON.stringify(r), 'is out of bounds:', JSON.stringify(bounds));
				continue;
			}

			for (let x = r.x1; x <= r.x2; x++) {
				for (let y = r.y1; y <= r.y2; y++) {
					if (x === r.x1 || x === r.x2 || y === r.y1 || y === r.y2) {
						if (roomTerrain[x][y] === NORMAL) roomTerrain[x][y] = PROTECTED;
					}
					else {
						roomTerrain[x][y] = UNWALKABLE;
					}
				}
			}
		}

		// Initialise graph
		// possible 2*50*50 +2 (st) Vertices (Walls etc set to unused later)
		const graph = new Graph((2 * 50 * 50) + 2);
		// Per Tile (0 in Array) top + bot with edge of c=1 from top to bott  (use every tile once!)
		// infinity edge from bot to top vertices of adjacent tiles if they not protected (array =1) (no reverse edges in normal graph)
		// per prot. Tile (1 in array) Edge from source to this tile with infinity cap.
		// per exit Tile (2in array) Edge to sink with infinity cap.
		// source is at  pos 2*50*50, sink at 2*50*50+1 as first tile is 0,0 => pos 0
		// top vertices <-> x,y : v=y*50+x   and x= v % 50  y=v/50 (math.floor?)
		// bot vertices <-> top + 2500
		const source = 2 * 50 * 50;
		const sink = (2 * 50 * 50) + 1;
		const max = 49;
		for (let x = 1; x < max; x++) {
			for (let y = 1; y < max; y++) {
				const top = (y * 50) + x;
				const bot = top + 2500;
				if (roomTerrain[x][y] === NORMAL) {
					graph.addEdge(top, bot, 1);
					for (const [dx, dy] of surroundingTiles) {
						if (roomTerrain[x + dx][y + dy] === NORMAL || roomTerrain[x + dx][y + dy] === TO_EXIT) {
							graph.addEdge(bot, ((y + dy) * 50) + x + dx, infinity);
						}
					}
				}
				else if (roomTerrain[x][y] === PROTECTED) {
					graph.addEdge(source, top, infinity);
					graph.addEdge(top, bot, 1);
					for (const [dx, dy] of surroundingTiles) {
						if (roomTerrain[x + dx][y + dy] === NORMAL || roomTerrain[x + dx][y + dy] === TO_EXIT) {
							graph.addEdge(bot, ((y + dy) * 50) + x + dx, infinity);
						}
					}
				}
				else if (roomTerrain[x][y] === TO_EXIT) {
					graph.addEdge(top, sink, infinity);
				}
			}
		}

		return graph;
	},

	/**
	 * Removes unneccary cut-tiles if bounds are set to include some dead ends
	 */
	deleteTilesLeadingToDeadEnds(roomName, minCut) {
		// Get terrain and set all cut-tiles as unwalkable.
		const roomTerrain = generateRoomTerrainArray(roomName);
		for (const tile of minCut) {
			roomTerrain[tile.x][tile.y] = UNWALKABLE;
		}

		// Floodfill from exits: save exit tiles in array and do a pathExistsBetween-like search
		const openList = [];
		const max = 49;
		for (let y = 0; y < max; y++) {
			if (roomTerrain[1][y] === TO_EXIT) openList.push((50 * y) + 1);
			if (roomTerrain[48][y] === TO_EXIT) openList.push((50 * y) + 48);
		}

		for (let x = 0; x < max; x++) {
			if (roomTerrain[x][1] === TO_EXIT) openList.push((50 * 1) + x);
			if (roomTerrain[x][48] === TO_EXIT) openList.push((50 * 48) + x);
		}

		// Iterate over all unvisited TO_EXIT-Tiles and mark neigbours as TO_EXIT tiles, if walkable (NORMAL), and add to unvisited
		while (openList.length > 0) {
			const index = openList.pop();
			const x = index % 50;
			const y = Math.floor(index / 50);
			for (const [dx, dy] of surroundingTiles) {
				if (roomTerrain[x + dx][y + dy] === NORMAL) {
					openList.push((50 * (y + dy)) + x + dx);
					roomTerrain[x + dx][y + dy] = TO_EXIT;
				}
			}
		}

		// Remove min-Cut-Tile if there is no TO_EXIT surrounding it
		for (let i = minCut.length - 1; i >= 0; i--) {
			let leadsToExit = false;
			const x = minCut[i].x;
			const y = minCut[i].y;
			for (const [dx, dy] of surroundingTiles) {
				if (roomTerrain[x + dx][y + dy] === TO_EXIT) {
					leadsToExit = true;
				}
			}

			if (!leadsToExit) {
				minCut.splice(i, 1);
			}
		}
	},

	// Calculates min cut tiles from room, rect[]
	getCutTiles(roomName, rect, bounds = {x1: 0, y1: 0, x2: 49, y2: 49}, verbose = false) {
		const graph = minCutInterface.createGraph(roomName, rect, bounds);
		if (!graph) return [];

		const source = 2 * 50 * 50; // Position Source / Sink in Room-Graph
		const sink = (2 * 50 * 50) + 1;
		const count = graph.calculateMinCut(source, sink);
		if (verbose) console.log('Number of Tiles in Cut:', count);
		const positions = [];
		if (count > 0) {
			const cutEdges = graph.markReachableVertices(source);
			// Get Positions from Edge
			for (const cutEdge of cutEdges) {
				const x = cutEdge % 50;
				const y = Math.floor(cutEdge / 50);
				positions.push({x, y});
			}
		}

		// If bounds are given, try to detect islands of walkable tiles, which are
		// not conntected to the exits, and delete them from the cut-tiles.
		const isWholeRoom = (bounds.x1 === 0 && bounds.y1 === 0 && bounds.x2 === 49 && bounds.y2 === 49);
		if (positions.length > 0 && !isWholeRoom) minCutInterface.deleteTilesLeadingToDeadEnds(roomName, positions);

		return positions;
	},
};

export default minCutInterface;
