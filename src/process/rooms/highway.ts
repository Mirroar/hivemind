import Process from 'process/process';
import {getRoomIntel} from 'intel-management';
import {isCrossroads} from 'utils/room-name';

declare global {
	interface StrategyMemory {
		caravans?: {
			[id: string]: {
				creeps: Id<Creep>[];
				dir: TOP | BOTTOM | LEFT | RIGHT;
				firstSeen: number;
				expires: number;
				rooms: {
					name: string;
					time: number;
				}[];
				contents: Record<string, number>;
			};
		};
	}
}

export default class OwnedRoomProcess extends Process {
	room: Room;

	/**
	 * Manages rooms we own.
	 * @constructor
	 *
	 * @param {object} params
	 *   Options on how to run this process.
	 * @param {object} data
	 *   Memory object allocated for this process' stats.
	 */
	constructor(params, data) {
		super(params, data);
		this.room = params.room;
	}

	/**
	 * Manages one of our rooms.
	 */
	run() {
		this.detectCaravans();
	}

	detectCaravans() {
		for (const creep of this.room.enemyCreeps[SYSTEM_USERNAME] || []) {
			const id = this.getCaravanId(creep);
			if (!id) continue;

			this.registerCaravan(id);
		}
	}

	getCaravanId(creep: Creep): string {
		if (!creep.name.includes('_', creep.name.length - 2)) return null;

		return creep.name.substr(0, creep.name.length - 2);
	}

	registerCaravan(id: string) {
		if (!Memory.strategy) Memory.strategy = {};
		if (!Memory.strategy.caravans) Memory.strategy.caravans = {};

		const creeps = _.sortBy(_.filter(this.room.enemyCreeps[SYSTEM_USERNAME], c => c.name.startsWith(id)), c => c.name);
		if (Memory.strategy.caravans[id] && creeps.length < Memory.strategy.caravans[id].creeps.length) {
			// Don't update info about caravans that are already registered if we
			// can't see all previously known creeps.
			return;
		}

		const direction = this.detectDirection(creeps);
		if (!direction) return;

		const firstSeen = Memory.strategy.caravans[id]?.firstSeen || Game.time;
		const rooms = this.getTraversedRooms(direction, creeps, firstSeen);

		Memory.strategy.caravans[id] = {
			firstSeen,
			creeps: _.map<Creep, Id<Creep>>(creeps, 'id'),
			dir: direction,
			expires: rooms[rooms.length - 1].time + 50,
			rooms,
			contents: this.getStoreContents(creeps),
		}
	}

	detectDirection(creeps: Creep[]): TOP | BOTTOM | LEFT | RIGHT {
		const minX = _.min(creeps, c => c.pos.x);
		const maxX = _.max(creeps, c => c.pos.x);
		const minY = _.min(creeps, c => c.pos.y);
		const maxY = _.max(creeps, c => c.pos.y);

		const first = creeps[0].id;
		const last = creeps[creeps.length - 1].id;

		// If moving diagonally we need to adjust direction based on what kind
		// of highway room it is.
		const allowVertical = isCrossroads(this.room.name) || !this.room.name.endsWith('0');
		const allowHorizontal = isCrossroads(this.room.name) || this.room.name.endsWith('0');

		if (allowHorizontal && minX.id === first && maxX.id === last) return LEFT;
		if (allowHorizontal && maxX.id === first && minX.id === last) return RIGHT;
		if (allowVertical && minY.id === first && maxY.id === last) return TOP;
		if (allowVertical && maxY.id === first && minY.id === last) return BOTTOM;

		return null;
	}

	getTraversedRooms(direction: TOP | BOTTOM | LEFT | RIGHT, creeps: Creep[], firstSeen: number): {name: string; time: number}[] {
		const rooms: {name: string; time: number}[] = [];

		rooms.push({
			name: this.room.name,
			time: Game.time,
		});

		const skipFirstCrossroads = isCrossroads(this.room.name) && Game.time - firstSeen < 75;
		// @todo Estimate how far caravan needs to travel to room edge.
		let nextTime = Game.time + 50;
		let roomName = this.room.name;
		while (!isCrossroads(roomName) || (roomName === this.room.name && skipFirstCrossroads)) {
			const roomIntel = getRoomIntel(roomName);
			const exits = roomIntel.getAge() < 10000 ? roomIntel.getExits() : Game.map.describeExits(roomName);

			roomName = exits[direction];
			rooms.push({
				name: roomName,
				time: nextTime,
			});
			nextTime += 99 - creeps.length;
		}

		return rooms;
	}

	getStoreContents(creeps: Creep[]): Record<string, number> {
		const result: Record<string, number> = {};

		for (const creep of creeps) {
			for (const resourceType in creep.store) {
				result[resourceType] = (result[resourceType] || 0) + (creep.store[resourceType] || 0);
			}
		}

		return result;
	}
}
