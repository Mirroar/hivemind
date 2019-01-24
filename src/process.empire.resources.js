'use strict';

var Process = require('process');
var utilities = require('utilities');

var ResourcesProcess = function (params, data) {
	Process.call(this, params, data);
};
ResourcesProcess.prototype = Object.create(Process.prototype);

/**
 * Transports resources between owned rooms if needed.
 */
ResourcesProcess.prototype.run = function () {
	let routes = this.getAvailableTransportRoutes();
	let best = utilities.getBestOption(routes);

	if (best) {
		let room = Game.rooms[best.source];
		let terminal = room.terminal;
		let storage = room.storage;
		if (terminal.store[best.resourceType] && terminal.store[best.resourceType] > 5000) {
			let result = terminal.send(best.resourceType, 5000, best.target, "Resource equalizing");
			hivemind.log('trade').info("sending", best.resourceType, "from", best.source, "to", best.target, ":", result);
		}
		else if (room.isEvacuating() && room.storage && !room.storage[best.resourceType] && terminal.store[best.resourceType]) {
			let amount = terminal.store[best.resourceType];
			let result = terminal.send(best.resourceType, amount, best.target, "Resource equalizing");
			hivemind.log('trade').info("sending", amount, best.resourceType, "from", best.source, "to", best.target, ":", result);
		}
		else {
			hivemind.log('trade').info("Preparing 5000", best.resourceType, 'for transport from', best.source, 'to', best.target);
			room.prepareForTrading(best.resourceType);
		}
	}
};

/**
 * Determines when it makes sense to transport resources between rooms.
 */
ResourcesProcess.prototype.getAvailableTransportRoutes = function () {
	let options = [];
	let rooms = [];

	// Collect room resource states.
	for (let roomName in Game.rooms) {
		let roomData = Game.rooms[roomName].getResourceState();
		if (roomData) {
			rooms[roomName] = roomData;
		}
	}

	for (let roomName in rooms) {
		let roomState = rooms[roomName];
		if (!roomState.canTrade) continue;

		// Do not try transferring from a room that is already preparing a transfer.
		if (Game.rooms[roomName].memory.fillTerminal && !roomState.isEvacuating) continue;

		for (let resourceType in roomState.state) {
			if (roomState.state[resourceType] == 'high' || roomState.state[resourceType] == 'excessive' || roomState.isEvacuating) {
				// Make sure we have enough to send (while evacuating).
				if (roomState.totalResources[resourceType] < 100) continue;
				if (resourceType == RESOURCE_ENERGY && roomState.totalResources[resourceType] < 10000) continue;

				// Look for other rooms that are low on this resource.
				for (let roomName2 in rooms) {
					if (!rooms[roomName2].canTrade) continue;
					if (rooms[roomName2].isEvacuating) continue;

					if (roomState.isEvacuating || !rooms[roomName2].state[resourceType] || rooms[roomName2].state[resourceType] == 'low' || (roomState.state[resourceType] == 'excessive' && (rooms[roomName2].state[resourceType] == 'medium' || rooms[roomName2].state[resourceType] == 'high'))) {

						// Make sure target has space left.
						if (_.sum(Game.rooms[roomName2].terminal.store) > Game.rooms[roomName2].terminal.storeCapacity - 5000) {
							continue;
						}

						let option = {
							priority: 3,
							weight: (roomState.totalResources[resourceType] - rooms[roomName2].totalResources[resourceType]) / 100000 - Game.map.getRoomLinearDistance(roomName, roomName2),
							resourceType: resourceType,
							source: roomName,
							target: roomName2,
						};

						if (roomState.isEvacuating && resourceType != RESOURCE_ENERGY) {
							option.priority++;
							if (Game.rooms[roomName].terminal.store[resourceType] && Game.rooms[roomName].terminal.store[resourceType] >= 5000) {
								option.priority++;
							}
						}
						else if (rooms[roomName2].state[resourceType] == 'medium') {
							option.priority--;
						}

						//option.priority -= Game.map.getRoomLinearDistance(roomName, roomName2) * 0.5;

						options.push(option);
					}
				}
			}
		}
	}

	return options;
};

module.exports = ResourcesProcess;
