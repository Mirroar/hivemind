import hivemind from './hivemind';
import BoostManager from './manager.boost';
import Process from './process';
import RoomPlanner from './room-planner';
import RoomManager from './room-manager';
import Squad from './manager.squad';

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
	default: require('./operation'),
	mining: require('./operation.remote-mining'),
	room: require('./operation.room'),
};

/**
 * Initializes member variables that should be available to all processes.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const InitProcess = function (params, data) {
	Process.call(this, params, data);
};

InitProcess.prototype = Object.create(Process.prototype);

/**
 * @override
 */
InitProcess.prototype.run = function () {
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
};

export default InitProcess;
