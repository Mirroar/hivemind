import {packCoordList, unpackCoordListAsPosList} from 'utils/packrat';
import {serializeCoords} from 'utils/serialization';

declare global {
	type SerializedPlan = {
		[type: string]: string;
	};
}

type PositionCache = {
	[type: string]: {
		[coords: number]: RoomPosition;
	};
};

const structureSymbols = {
	container: '⊔',
	exit: '🚪',
	extension: '⚬',
	factory: '⚙',
	lab: '🔬',
	link: '🔗',
	nuker: '☢',
	observer: '👁',
	powerSpawn: '⚡',
	road: '·',
	spawn: '⭕',
	storage: '⬓',
	terminal: '⛋',
	tower: '⚔',
	wall: '▦',
};

export default class RoomPlan {
	public readonly MAX_ROOM_LEVEL = 8;

	public readonly roomName: string;
	protected positionsByType: PositionCache;
	protected maxLevel: number;

	constructor(roomName: string, input?: SerializedPlan, maxLevel?: number) {
		this.roomName = roomName;
		this.maxLevel = maxLevel || this.MAX_ROOM_LEVEL;
		this.positionsByType = {};
		if (input) this.unserialize(input);
	}

	serialize(): SerializedPlan {
		return _.mapValues(this.positionsByType, (positions: Record<number, RoomPosition>) => packCoordList(_.values(positions)));
	}

	unserialize(input: SerializedPlan) {
		this.positionsByType = _.mapValues(input, function (posList: string): {[coords: number]: RoomPosition} {
			const positions = unpackCoordListAsPosList(posList, this.roomName);
			const cache: {
				[coords: number]: RoomPosition;
			} = {};

			for (const pos of positions) {
				const coord = serializeCoords(pos.x, pos.y);
				cache[coord] = pos;
			}

			return cache;
		}, this);
	}

	addPosition(type: string, pos: RoomPosition) {
		if (!this.positionsByType[type]) this.positionsByType[type] = {};

		this.positionsByType[type][serializeCoords(pos.x, pos.y)] = pos;
	}

	removePosition(type: string, pos: RoomPosition) {
		delete this.positionsByType[type][serializeCoords(pos.x, pos.y)];
	}

	removeAllPositions(type?: string) {
		if (type) {
			delete this.positionsByType[type];
			return;
		}

		this.positionsByType = {};
	}

	hasPosition(type: string, pos: RoomPosition): boolean {
		if (!this.positionsByType[type]) return false;

		return Boolean(this.positionsByType[type][serializeCoords(pos.x, pos.y)]);
	}

	getPositions(type: string): RoomPosition[] {
		return _.values(this.positionsByType[type]);
	}

	getPositionTypes(): string[] {
		return _.keys(this.positionsByType);
	}

	/**
	 * Determines whether more of a certain structure could be placed.
	 *
	 * @param {string} structureType
	 *   The type of structure to check for.
	 *
	 * @return {boolean}
	 *   True if the current controller level allows more of this structure.
	 */
	canPlaceMore(structureType: StructureConstant): boolean {
		return this.remainingStructureCount(structureType) > 0;
	}

	/**
	 * Determines the number of structures of a type that could be placed.
	 *
	 * @param {string} structureType
	 *   The type of structure to check for.
	 *
	 * @return {number}
	 *   The number of structures of the given type that may still be placed.
	 */
	remainingStructureCount(structureType: StructureConstant): number {
		return CONTROLLER_STRUCTURES[structureType][this.maxLevel] - _.size(this.getPositions(structureType) || []);
	}

	/**
	 * Draws a simple representation of the room layout using RoomVisuals.
	 */
	visualize() {
		const visual = new RoomVisual(this.roomName);
		for (const type in this.positionsByType) {
			if (!structureSymbols[type]) continue;

			const positions = this.positionsByType[type];
			for (const pos of _.values<RoomPosition>(positions)) {
				visual.text(structureSymbols[type], pos.x, pos.y + 0.2);
			}
		}

		for (const pos of _.values<RoomPosition>(this.positionsByType.rampart || [])) {
			visual.rect(pos.x - 0.5, pos.y - 0.5, 1, 1, {fill: '#0f0', opacity: 0.2});
		}
	}

	/**
	 * Gets a cost matrix representing this room when it's fully built.
	 *
	 * @return {PathFinder.CostMatrix}
	 *   The requested cost matrix.
	 */
	createNavigationMatrix(): CostMatrix {
		const matrix = new PathFinder.CostMatrix();

		for (const locationType of this.getPositionTypes()) {
			if (!['road', 'harvester', 'bay_center', 'wall'].includes(locationType) && !(OBSTACLE_OBJECT_TYPES as string[]).includes(locationType)) continue;

			for (const pos of this.getPositions(locationType)) {
				if (locationType === 'road') {
					if (matrix.get(pos.x, pos.y) === 0) {
						matrix.set(pos.x, pos.y, 1);
					}
				}
				else {
					matrix.set(pos.x, pos.y, 255);
				}
			}
		}

		return matrix;
	}
}
