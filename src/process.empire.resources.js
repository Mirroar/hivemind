'use strict';

/* global hivemind RESOURCE_ENERGY */

const Process = require('./process');
const utilities = require('./utilities');

/**
 * Sends resources between owned rooms when needed.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const ResourcesProcess = function (params, data) {
	Process.call(this, params, data);
};

ResourcesProcess.prototype = Object.create(Process.prototype);

/**
 * Transports resources between owned rooms if needed.
 */
ResourcesProcess.prototype.run = function () {
	let routes = this.getAvailableTransportRoutes();
	let best = utilities.getBestOption(routes);

	while (best) {
		const room = Game.rooms[best.source];
		const terminal = room.terminal;
		if (room.isEvacuating() && terminal.store[best.resourceType] && terminal.store[best.resourceType] > 5000) {
			let amount = Math.min(terminal.store[best.resourceType], 50000);
			if (best.resourceType === RESOURCE_ENERGY) {
				amount -= Game.market.calcTransactionCost(amount, best.source, best.target);
			}

			const result = terminal.send(best.resourceType, amount, best.target, 'Evacuating');
			hivemind.log('trade').info('evacuating', amount, best.resourceType, 'from', best.source, 'to', best.target, ':', result);
		}
		else if (terminal.store[best.resourceType] && terminal.store[best.resourceType] > 5000) {
			const result = terminal.send(best.resourceType, 5000, best.target, 'Resource equalizing');
			hivemind.log('trade').info('sending', best.resourceType, 'from', best.source, 'to', best.target, ':', result);
		}
		else if (room.isEvacuating() && room.storage && !room.storage[best.resourceType] && terminal.store[best.resourceType]) {
			const amount = terminal.store[best.resourceType];
			const result = terminal.send(best.resourceType, amount, best.target, 'Evacuating');
			hivemind.log('trade').info('evacuating', amount, best.resourceType, 'from', best.source, 'to', best.target, ':', result);
		}
		else {
			hivemind.log('trade').info('Preparing 5000', best.resourceType, 'for transport from', best.source, 'to', best.target);
			room.prepareForTrading(best.resourceType);
		}

		// Use multiple routes as long as no room is involved multiple times.
		routes = _.filter(routes, option => option.source !== best.source && option.target !== best.source && option.source !== best.target && option.target !== best.target);
		best = utilities.getBestOption(routes);
	}
};

/**
 * Determines when it makes sense to transport resources between rooms.
 *
 * @return {Array}
 *   An array of option objects with priorities.
 */
ResourcesProcess.prototype.getAvailableTransportRoutes = function () {
	const options = [];
	const rooms = this.getResourceStates();

	_.each(rooms, (roomState, roomName) => {
		const room = Game.rooms[roomName];
		if (!roomState.canTrade) return;

		// Do not try transferring from a room that is already preparing a transfer.
		if (room.memory.fillTerminal && !roomState.isEvacuating) return;

		for (const resourceType of _.keys(roomState.state)) {
			const resourceLevel = roomState.state[resourceType] || 'low';
			if (!_.includes(['high', 'excessive'], resourceLevel) && !roomState.isEvacuating && !_.includes(SYMBOLS, resourceType)) continue;

			// Make sure we have enough to send (while evacuating).
			if (roomState.totalResources[resourceType] < 100) continue;
			if (resourceType === RESOURCE_ENERGY && roomState.totalResources[resourceType] < 10000) continue;

			// Don't send away symbols needed in this room.
			// @todo Unless there's a better room with the same symbol?
			if (resourceType === room.decoder.resourceType) continue;

			// Look for other rooms that are low on this resource.
			_.each(rooms, (roomState2, roomName2) => {
				const room2 = Game.rooms[roomName2];
				const resourceLevel2 = roomState2.state[resourceType] || 'low';

				if (!roomState2.canTrade) return;
				if (roomState2.isEvacuating) return;
				if (resourceType === room2.decoder.resourceType) {
					options.push({
						priority: 3,
						weight: ((roomState.totalResources[resourceType] - roomState2.totalResources[resourceType]) / 100000) - Game.map.getRoomLinearDistance(roomName, roomName2),
						resourceType,
						source: roomName,
						target: roomName2,
					});
				}
				else if (_.includes(SYMBOLS, resourceType) && !roomState.isEvacuating) return;


				const isLow = resourceLevel2 === 'low';
				const isLowEnough = resourceLevel2 === 'medium';
				const shouldReceiveResources = isLow || (roomState.state[resourceType] === 'excessive' && isLowEnough);

				if (!roomState.isEvacuating && !shouldReceiveResources) return;

				// Make sure target has space left.
				if (room2.terminal.storeCapacity - _.sum(room2.terminal.store) < 5000) return;

				// Make sure source room has enough energy to send resources.
				if (room.terminal.store.energy < Game.market.calcTransactionCost(5000, roomName, roomName2)) return;

				const option = {
					priority: 3,
					weight: ((roomState.totalResources[resourceType] - roomState2.totalResources[resourceType]) / 100000) - Game.map.getRoomLinearDistance(roomName, roomName2),
					resourceType,
					source: roomName,
					target: roomName2,
				};

				if (roomState.isEvacuating && resourceType !== RESOURCE_ENERGY) {
					option.priority++;
					if (room.terminal.store[resourceType] && room.terminal.store[resourceType] >= 5000) {
						option.priority++;
					}
				}
				else if (!isLow) {
					option.priority--;
				}

				options.push(option);
			});
		}
	});

	return options;
};

/**
 * Collects resource states of all available rooms.
 *
 * @return {object}
 *   Resource states, keyed by room name.
 */
ResourcesProcess.prototype.getResourceStates = function () {
	const rooms = {};

	// Collect room resource states.
	for (const room of _.values(Game.rooms)) {
		if (!room.isMine()) continue;

		const roomData = room.getResourceState();
		if (roomData) {
			rooms[room.name] = roomData;
		}
	}

	return rooms;
};

module.exports = ResourcesProcess;
