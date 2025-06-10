import Process from 'process/process';
import BoostManager from 'boost-manager';
import cache from 'utils/cache';
import hivemind from 'hivemind';
import RoomManager from 'room/room-manager';
import RoomPlanner from 'room/planner/room-planner';
import Squad from 'manager.squad';

import MiningOperation from 'operation/remote-mining';
import RoomOperation from 'operation/room';

declare global {
	interface Game {
		creepsByRole: Record<string, Record<string, Creep>>;
		creepsBySquad: Record<string, Partial<Record<SquadUnitType, Record<string, Creep>>>>;
		myRooms: Room[];
	}
}

const operationClasses = {
	mining: MiningOperation,
	room: RoomOperation,
};

export default class InitProcess extends Process {
	/**
	 * @override
	 */
	run() {
		Game.creepsByRole = {};
		Game.creepsBySquad = {};
		Game.operations = {};
		Game.operationsByType = {};

		// Add data to global Game object.
		_.each(operationClasses, (opClass, opType) => {
			Game.operationsByType[opType] = {};
		});
		_.each(Memory.operations, (data, opName) => {
			if (data.shouldTerminate) {
				delete Memory.operations[opName];
				return;
			}

			if (operationClasses[data.type]) {
				const operation = new operationClasses[data.type](opName);
				Game.operations[opName] = operation;
				Game.operationsByType[data.type][opName] = operation;
			}
		});

		// Define quick access property Game.myRooms.
		Object.defineProperty(Game, 'myRooms', {

			/**
			 * Gets a filtered list of all owned rooms.
			 *
			 * @return {Room[]}
			 *   An array of all rooms we own.
			 */
			get() {
				return cache.inObject(this, 'myRooms', 0, () => _.filter(this.rooms, (room: Room) => room.isMine()));
			},
			enumerable: false,
			configurable: true,
		});

		// Cache creeps per room and role.
		_.each(Game.creeps, (creep: Creep) => {
			creep.enhanceData();
		});

		_.each(Game.rooms, room => {
			if (room.isMine()) {
				if (hivemind.segmentMemory.isReady()) room.roomPlanner = new RoomPlanner(room.name);
				room.roomManager = new RoomManager(room);
				room.boostManager = new BoostManager(room);
				room.boostManager.manageBoostLabs();
				room.generateLinkNetwork();
			}

			room.enhanceData();
		});
	}
}
