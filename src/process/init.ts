import hivemind from 'hivemind';
import BoostManager from 'manager.boost';
import Process from 'process/process';
import RoomPlanner from 'room-planner';
import RoomManager from 'room-manager';
import Squad from 'manager.squad';

import Operation from 'operation/operation';
import MiningOperation from 'operation/remote-mining';
import RoomOperation from 'operation/room';

declare global {
	interface Game {
		exploits,
		creepsByRole: {
			[key: string]: {
				[key: string]: Creep,
			},
		},
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
