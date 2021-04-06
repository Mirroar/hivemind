'use strict';

/* global hivemind RESOURCE_ENERGY */

const Process = require('./process');
const TradeRoute = require('./trade-route');
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
		else if (room.storage && !room.storage[best.resourceType] && terminal.store[best.resourceType]) {
			// @tode Maybe don't send if a transporter still has this resource loaded.
			const amount = terminal.store[best.resourceType];
			const result = terminal.send(best.resourceType, amount, best.target, 'Evacuating');
			hivemind.log('trade').info('sending', amount, best.resourceType, 'from', best.source, 'to', best.target, ':', result);
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
	const symbolTargets = this.getSymbolTargetRooms();

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

			// Look for other rooms that are low on this resource.
			_.each(rooms, (roomState2, roomName2) => {
				const room2 = Game.rooms[roomName2];
				const resourceLevel2 = roomState2.state[resourceType] || 'low';

				if (!roomState2.canTrade) return;
				if (roomState2.isEvacuating) return;
				if (roomName === roomName2) return;

				if (symbolTargets[resourceType] && symbolTargets[resourceType] === roomName2) {
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

ResourcesProcess.prototype.getSymbolTargetRooms = function () {
	const destinations = this.getSymbolDestinations();

	const targets = {};
	_.each(destinations, (options, resourceType) => {
		_.each(options, option => {
			option.priority = option.rcl;
			option.weight = option.type === 'room' ? 1 : 1 - (option.path ? option.path.length / 30 : 1);
		});

		const best = utilities.getBestOption(options);
		targets[resourceType] = best.roomName;

		// @todo This part should really not be in a getter type function.
		// Disable all (other) trade routes for this resourceType.
		_.each(Memory.tradeRoutes, route => {
			if (route.resourceType === resourceType) route.active = false;
		})

		// Enable trade routes.
		if (best.type === 'trade_route' && best.path) {
			const routeName = best.roomName + '-' + resourceType + '-' + best.destination;
			const route = new TradeRoute(routeName);
			route.setOrigin(best.roomName);
			route.setTarget(best.destination);
			route.setPath(best.path);
			route.setResourceType(resourceType);
			route.setActive(true);
		}
	});

	return targets;
}

const tradeRouteTargets = {
	// E7N25: {sourceRoom: 'E11N22', resourceType: 'symbol_teth', rcl: 7},

	// E6N23: {sourceRoom: 'E11N22', resourceType: 'symbol_pe', rcl: 8, path: ['E11N23', 'E10N24', 'E9N24', 'E8N24', 'E7N23', 'E6N23']},
	// E3N26: {sourceRoom: 'E11N22', resourceType: 'symbol_nun', rcl: 8, path: ['E11N23', 'E10N24', 'E9N24', 'E9N25', 'E9N26', 'E8N26', 'E7N26', 'E7N27', 'E6N27', 'E5N27', 'E5N28', 'E4N28', 'E3N28', 'E3N27', 'E3N26']},
	// E2N21: {sourceRoom: 'E11N22', resourceType: 'symbol_yodh', rcl: 8, path: ['E11N23', 'E10N24', 'E9N24', 'E10N23', 'E10N22', 'E10N21', 'E10N20', 'E9N20', 'E8N20', 'E7N20', 'E6N20', 'E5N20', 'E4N20', 'E4N21', 'E3N21', 'E2N21']},
	// E4N28: {sourceRoom: 'E11N22', resourceType: 'symbol_nun', rcl: 8, path: ['E11N23', 'E10N24', 'E9N24', 'E9N25', 'E9N26', 'E8N26', 'E7N26', 'E7N27', 'E6N27', 'E5N27', 'E5N28', 'E4N28']},
	// E2N28: {sourceRoom: 'E11N22', resourceType: 'symbol_ayin', rcl: 8, path: ['E11N23', 'E10N24', 'E9N24', 'E9N25', 'E9N26', 'E8N26', 'E7N26', 'E7N27', 'E6N27', 'E5N27', 'E5N28', 'E4N28', 'E3N28', 'E2N28']},

	// E21N21: {sourceRoom: 'E19N22', resourceType: 'symbol_aleph', rcl: 7, path: ['E19N21', 'E20N21', 'E21N21']},
	// E23N23: {sourceRoom: 'E19N22', resourceType: 'symbol_nun', rcl: 8, path: ['E19N21', 'E20N21', 'E21N22', 'E22N23', 'E23N23']},
	// E21N25: {sourceRoom: 'E19N22', resourceType: 'symbol_nunmbol_zayin', rcl: 8, path: ['E19N21', 'E20N21', 'E21N22', 'E21N23', 'E21N24', 'E21N25']},
	// E27N22: {sourceRoom: 'E19N22', resourceType: 'symbol_qoph', rcl: 8, path: ['E19N21', 'E20N21', 'E21N20', 'E22N20', 'E23N20', 'E24N20', 'E25N20', 'E25N21', 'E26N22', 'E27N22']},
	// E27N25: {sourceRoom: 'E19N22', resourceType: 'symbol_heth', rcl: 7, path: ['E19N21', 'E20N21', 'E21N20', 'E22N20', 'E23N20', 'E24N20', 'E25N20', 'E25N21', 'E26N22', 'E27N22', 'E27N23', 'E27N24']},

	// Montblanc
	W13N27: {sourceRoom: 'W13N29', resourceType: 'symbol_yodh', rcl: 6, path: ['W14N28', 'W13N27']},

	// Starting from W12N25.
	// W11N23: {sourceRoom: 'W12N25', resourceType: 'symbol_ayin', rcl: 7, path: ['W11N25', 'W11N24', 'W11N23']},
	// W14N18: {sourceRoom: 'W12N25', resourceType: 'symbol_yodh', rcl: 8, path: ['W11N25', 'W10N24', 'W10N23', 'W10N22', 'W10N21', 'W11N20', 'W11N19', 'W12N18', 'W13N18', 'W14N18']},
	// W11N17: {sourceRoom: 'W12N25', resourceType: 'symbol_nun', rcl: 8, path: ['W11N25', 'W10N24', 'W10N23', 'W10N22', 'W10N21', 'W11N20', 'W11N19', 'W12N18', 'W11N17']},
	// W11N12: {sourceRoom: 'W12N25', resourceType: 'symbol_kaph', rcl: 8, path: ['W11N25', 'W10N24', 'W10N23', 'W10N22', 'W10N21', 'W11N20', 'W10N19', 'W10N18', 'W10N17', 'W10N16', 'W10N15', 'W10N14', 'W10N13', 'W11N12']},
	// W12N11: {sourceRoom: 'W12N25', resourceType: 'symbol_qoph', rcl: 8, path: ['W11N25', 'W10N24', 'W10N23', 'W10N22', 'W10N21', 'W11N20', 'W10N19', 'W10N18', 'W10N17', 'W10N16', 'W10N15', 'W10N14', 'W10N13', 'W10N12', 'W11N11', 'W12N11']},

	// Starting from W14N22.
	W11N23: {sourceRoom: 'W14N22', resourceType: 'symbol_ayin', rcl: 7, path: ['W13N22', 'W12N22', 'W11N23']},
	W14N18: {sourceRoom: 'W14N22', resourceType: 'symbol_yodh', rcl: 8, path: ['W13N22', 'W12N22', 'W11N22', 'W10N21', 'W11N20', 'W11N19', 'W12N18', 'W13N18', 'W14N18']},
	W11N17: {sourceRoom: 'W14N22', resourceType: 'symbol_nun', rcl: 8, path: ['W13N22', 'W12N22', 'W11N22', 'W10N21', 'W11N20', 'W11N19', 'W12N18', 'W11N17']},
	W11N12: {sourceRoom: 'W14N22', resourceType: 'symbol_kaph', rcl: 8, path: ['W13N22', 'W12N22', 'W11N22', 'W10N21', 'W11N20', 'W10N19', 'W10N18', 'W10N17', 'W10N16', 'W10N15', 'W10N14', 'W10N13', 'W11N12']},
	W12N11: {sourceRoom: 'W14N22', resourceType: 'symbol_qoph', rcl: 8, path: ['W13N22', 'W12N22', 'W11N22', 'W10N21', 'W11N20', 'W10N19', 'W10N18', 'W10N17', 'W10N16', 'W10N15', 'W10N14', 'W10N13', 'W10N12', 'W11N11', 'W12N11']},

	// Meridion
	// Starting from W12N25.
	W9N21: {sourceRoom: 'W12N25', resourceType: 'symbol_yodh', rcl: 8, path: ['W11N25', 'W10N24', 'W10N23', 'W10N22', 'W10N21', 'W9N21']},
	W8N27: {sourceRoom: 'W12N25', resourceType: 'symbol_mem', rcl: 8, path: ['W11N25', 'W10N24', 'W10N23', 'W10N22', 'W10N21', 'W9N22', 'W10N22', 'W10N23', 'W10N24', 'W10N25', 'W10N26', 'W9N27', 'W8N27']},
	W5N28: {sourceRoom: 'W12N25', resourceType: 'symbol_waw', rcl: 8, path: ['W11N25', 'W10N24', 'W10N23', 'W10N22', 'W10N21', 'W9N22', 'W10N22', 'W10N23', 'W10N24', 'W10N25', 'W10N26', 'W9N27', 'W7N28', 'W6N29', 'W5N28']},
	W1N28: {sourceRoom: 'W12N25', resourceType: 'symbol_tsade', rcl: 8, path: ['W11N25', 'W10N24', 'W10N23', 'W10N22', 'W10N21', 'W9N22', 'W10N22', 'W10N23', 'W10N24', 'W10N25', 'W10N26', 'W9N27', 'W7N28', 'W6N29', 'W5N29', 'W4N29', 'W3N29', 'W2N29', 'W1N28']},
	W5N23: {sourceRoom: 'W12N25', resourceType: 'symbol_kaph', rcl: 7, path: ['W11N25', 'W10N24', 'W10N23', 'W10N22', 'W10N21', 'W8N21', 'W7N22', 'W6N23', 'W5N23']},
	W1N22: {sourceRoom: 'W12N25', resourceType: 'symbol_he', rcl: 8, path: ['W11N25', 'W10N24', 'W10N23', 'W10N22', 'W10N21', 'W8N21', 'W7N21', 'W6N20', 'W5N20', 'W4N20', 'W3N20', 'W2N21', 'W1N22']},
	W2N25: {sourceRoom: 'W12N25', resourceType: 'symbol_mem', rcl: 8, path: ['W11N25', 'W10N24', 'W10N23', 'W10N22', 'W10N21', 'W8N21', 'W7N21', 'W6N20', 'W5N20', 'W4N20', 'W3N20', 'W2N21', 'W1N22', 'W1N23', 'W2N24', 'W2N25']},
};

ResourcesProcess.prototype.getSymbolDestinations = function () {
	const destinations = {};
	_.each(Game.rooms, room => {
		if (!room.isMine()) return;
		if (room.isEvacuating()) return;

		const resourceType = room.decoder.resourceType;
		if (!destinations[resourceType]) destinations[resourceType] = [];

		destinations[resourceType].push({
			type: 'room',
			roomName: room.name,
			resourceType,
			rcl: room.controller.level,
		});
	})

	_.each(tradeRouteTargets, (info, roomName) => {
		if (!destinations[info.resourceType]) destinations[info.resourceType] = [];

		destinations[info.resourceType].push({
			type: 'trade_route',
			roomName: info.sourceRoom,
			resourceType: info.resourceType,
			rcl: info.rcl,
			path: info.path,
			destination: roomName,
		});
	});

	return destinations;
};

module.exports = ResourcesProcess;
