import Process from 'process/process';
import BoostManager from 'manager.boost';
import cache from 'utils/cache';
import Exploit from 'manager.exploit';
import hivemind from 'hivemind';
import RoomManager from 'room/room-manager';
import RoomPlanner from 'room/planner/room-planner';
import Squad from 'manager.squad';

import Operation from 'operation/operation';
import MiningOperation from 'operation/remote-mining';
import RoomOperation from 'operation/room';

declare global {
	interface Game {
		creepsByRole: {
			[key: string]: {
				[key: string]: Creep,
			},
		},
		exploits: Record<string, Exploit>;
		myRooms: Room[];
	}
}

const operationClasses = {
	default: Operation,
	mining: MiningOperation,
	room: RoomOperation,
};

export default class InitProcess extends Process {
	/**
	 * @override
	 */
	run() {
		Game.squads = {};
		Game.exploits = {};
		Game.creepsByRole = {};
		Game.exploitTemp = {};
		Game.operations = {};
		Game.operationsByType = {
			mining: {},
			room: {},
		};

		// Add data to global Game object.
		_.each(Memory.squads, (data, squadName) => {
			Game.squads[squadName] = new Squad(squadName);
		});
		_.each(operationClasses, (opClass, opType) => {
			Game.operationsByType[opType] = {};
		});
		_.each(Memory.operations, (data, opName) => {
			if (data.shouldTerminate) {
				delete Memory.operations[opName];
				return;
			}

			const operation = new operationClasses[data.type](opName);
			Game.operations[opName] = operation;
			Game.operationsByType[data.type][opName] = operation;
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
		_.each(Game.creeps, creep => {
			creep.enhanceData();
		});

		_.each(Game.rooms, room => {
			if (room.isMine()) {
				if (hivemind.segmentMemory.isReady()) room.roomPlanner = new RoomPlanner(room.name);
				room.roomManager = new RoomManager(room);
				room.boostManager = new BoostManager(room.name);
				room.generateLinkNetwork();
			}

			room.enhanceData();
		});
	}
}
