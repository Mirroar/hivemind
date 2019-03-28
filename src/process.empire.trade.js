'use strict';

/* global hivemind RESOURCES_ALL RESOURCE_ENERGY RESOURCE_POWER OK
ORDER_BUY ORDER_SELL */

const Process = require('./process');

/**
 * Automatically trades resources on the open market.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const TradeProcess = function (params, data) {
	Process.call(this, params, data);
};

TradeProcess.prototype = Object.create(Process.prototype);

/**
 * Buys and sells resources on the global market.
 */
TradeProcess.prototype.run = function () {
	this.removeOldTrades();

	const resources = this.getRoomResourceStates();
	const total = resources.total;

	for (const resourceType of RESOURCES_ALL) {
		const tier = this.getResourceTier(resourceType);

		if (tier === 1) {
			const maxStorage = total.rooms * 50000;
			const highStorage = total.rooms * 20000;
			const lowStorage = total.rooms * 10000;
			const minStorage = total.rooms * 5000;

			// Check for base resources we have too much of.
			if ((total.resources[resourceType] || 0) > maxStorage) {
				this.instaSellResources(resourceType, resources.rooms);
			}
			else if ((total.resources[resourceType] || 0) > highStorage) {
				this.trySellResources(resourceType, resources.rooms);
			}
			else if ((total.resources[resourceType] || 0) < lowStorage && Game.market.credits > 1000) {
				// @todo Actually iterate over all tier 1 resources to make sure we buy every type.
				this.tryBuyResources(resourceType, resources.rooms);
			}
			else if ((total.resources[resourceType] || 0) < minStorage && Game.market.credits > 10000) {
				// @todo Actually iterate over all tier 1 resources to make sure we buy every type.
				this.instaBuyResources(resourceType, resources.rooms);
			}
		}
	}

	if (Game.market.credits > 5000) {
		// Also try to cheaply buy some energy for rooms that are low on it.
		_.each(resources.rooms, (roomState, roomName) => {
			if (!roomState.canTrade) return;
			if (roomState.isEvacuating) return;
			if ((roomState.totalResources[RESOURCE_ENERGY] || 0) > 100000) return;

			// @todo Force creating a buy order for every affected room.
			const temp = {
				[roomName]: roomState,
			};
			this.tryBuyResources(RESOURCE_ENERGY, temp, true);
		});
	}
};

/**
 * Determines the amount of available resources in each room.
 *
 * @return {object}
 *   An object containing the following keys:
 *   - rooms: An array of objects containing resource states for each room.
 *   - roral: Sum of all resource levels of each room.
 */
TradeProcess.prototype.getRoomResourceStates = function () {
	const rooms = {};
	const total = {
		resources: {},
		sources: {},
		rooms: 0,
	};

	for (const room of _.values(Game.rooms)) {
		const roomData = room.getResourceState();
		if (!roomData) continue;

		total.rooms++;
		for (const resourceType of _.keys(roomData.totalResources)) {
			total.resources[resourceType] = (total.resources[resourceType] || 0) + roomData.totalResources[resourceType];
		}

		total.sources[roomData.mineralType] = (total.sources[roomData.mineralType] || 0) + 1;
		rooms[room.name] = roomData;
	}

	return {
		rooms,
		total,
	};
};

/**
 * Tries to find a reasonable buy order for instantly getting rid of some resources.
 *
 * @param {string} resourceType
 *   The type of resource to trade.
 * @param {object} rooms
 *   Resource states for rooms to check, keyed by room name.
 */
TradeProcess.prototype.instaSellResources = function (resourceType, rooms) {
	// Find room with highest amount of this resource.
	const roomName = this.getHighestResourceState(resourceType, rooms);
	if (!roomName) return;

	const room = Game.rooms[roomName];

	const bestOrder = this.findBestBuyOrder(resourceType, roomName);

	if (!bestOrder) return;

	const amount = Math.min(5000, bestOrder.amount);
	const transactionCost = Game.market.calcTransactionCost(amount, roomName, bestOrder.roomName);

	if (amount > (room.terminal.store[resourceType] || 0)) {
		if (room.memory.fillTerminal) {
			hivemind.log('trade', roomName).info('Busy, can\'t prepare', amount, resourceType, 'for selling.');
		}
		else {
			room.prepareForTrading(resourceType, amount);
			hivemind.log('trade', roomName).info('Preparing', amount, resourceType, 'for selling to', bestOrder.roomName, 'at', bestOrder.price, 'credits each, costing', transactionCost, 'energy');
		}

		return;
	}

	if (transactionCost > room.terminal.store.energy) {
		if (room.memory.fillTerminal) {
			hivemind.log('trade', roomName).info('Busy, can\'t prepare', transactionCost, 'energy for selling', amount, resourceType);
		}
		else {
			room.prepareForTrading(RESOURCE_ENERGY, transactionCost);
			hivemind.log('trade', roomName).info('Preparing', transactionCost, 'energy for selling', amount, resourceType, 'to', bestOrder.roomName, 'at', bestOrder.price, 'credits each');
		}

		return;
	}

	hivemind.log('trade', roomName).info('Selling', amount, resourceType, 'to', bestOrder.roomName, 'for', bestOrder.price, 'credits each, costing', transactionCost, 'energy');

	const result = Game.market.deal(bestOrder.id, amount, roomName);
	if (result !== OK) {
		hivemind.log('trade', roomName).info('Transaction failed:', result);
	}
};

/**
 * Tries to find a reasonable sell order for instantly acquiring some resources.
 *
 * @param {string} resourceType
 *   The type of resource to trade.
 * @param {object} rooms
 *   Resource states for rooms to check, keyed by room name.
 */
TradeProcess.prototype.instaBuyResources = function (resourceType, rooms) {
	// Find room with lowest amount of this resource.
	const roomName = this.getLowestResourceState(resourceType, rooms);
	if (!roomName) return;

	const room = Game.rooms[roomName];

	const bestOrder = this.findBestSellOrder(resourceType, roomName);

	if (!bestOrder) return;

	const amount = Math.min(5000, bestOrder.amount);
	const transactionCost = Game.market.calcTransactionCost(amount, roomName, bestOrder.roomName);

	if (transactionCost > room.terminal.store.energy) {
		if (room.memory.fillTerminal) {
			hivemind.log('trade', roomName).info('Busy, can\'t prepare', transactionCost, 'energy for buying', amount, resourceType);
		}
		else {
			room.prepareForTrading(RESOURCE_ENERGY, transactionCost);
			hivemind.log('trade', roomName).info('Preparing', transactionCost, 'energy for buying', amount, resourceType, 'from', bestOrder.roomName, 'at', bestOrder.price, 'credits each');
		}

		return;
	}

	hivemind.log('trade', roomName).info('Buying', amount, resourceType, 'from', bestOrder.roomName, 'for', bestOrder.price, 'credits each, costing', transactionCost, 'energy');

	const result = Game.market.deal(bestOrder.id, amount, roomName);
	if (result !== OK) {
		hivemind.log('trade', roomName).info('Transaction failed:', result);
	}
};

/**
 * Creates a buy order at a reasonable price.
 *
 * @param {string} resourceType
 *   The type of resource to trade.
 * @param {object} rooms
 *   Resource states for rooms to check, keyed by room name.
 * @param {boolean} ignoreOtherRooms
 *   If set, only check agains orders from rooms given by `rooms` parameter.
 */
TradeProcess.prototype.tryBuyResources = function (resourceType, rooms, ignoreOtherRooms) {
	let npcPrice = 1;
	if (resourceType === RESOURCE_ENERGY) {
		npcPrice = 0.1;
	}

	if (_.filter(Game.market.orders, order => {
		if (order.type === ORDER_BUY && order.resourceType === resourceType) {
			if (ignoreOtherRooms && !rooms[order.roomName]) {
				return false;
			}

			return true;
		}
	}).length > 0) {
		return;
	}

	// Find room with lowest amount of this resource.
	const roomName = this.getLowestResourceState(resourceType, rooms);
	if (!roomName) return;

	// Find comparable deals for buying this resource.
	const bestBuyOrder = this.findBestBuyOrder(resourceType, roomName);
	const bestSellOrder = this.findBestSellOrder(resourceType, roomName);

	let offerPrice;
	if (bestBuyOrder && bestSellOrder) {
		hivemind.log('trade', roomName).info(resourceType, 'is currently being bought for', bestBuyOrder.price, 'and sold for', bestSellOrder.price, 'credits.');
		offerPrice = Math.min(bestBuyOrder.price * 0.9, bestSellOrder.price * 0.9);
	}
	else if (bestBuyOrder) {
		// Nobody is selling this resource, so adapt to the current buy price.
		hivemind.log('trade', roomName).info(resourceType, 'is currently being bought for', bestBuyOrder.price);
		offerPrice = bestBuyOrder.price * 0.9;
	}
	else {
		// Nobody is buying this resource, try to get NPC price for it.
		hivemind.log('trade', roomName).info('Nobody else is currently buying', resourceType);
		offerPrice = npcPrice;
	}

	hivemind.log('trade', roomName).debug('Offering to buy for', offerPrice);

	// Make sure we have enough credits to actually buy this.
	if (Game.market.credits < 10000 * offerPrice) return;

	Game.market.createOrder(ORDER_BUY, resourceType, offerPrice, 10000, roomName);
};

/**
 * Creates a sell order at a reasonable price.
 *
 * @param {string} resourceType
 *   The type of resource to trade.
 * @param {object} rooms
 *   Resource states for rooms to check, keyed by room name.
 */
TradeProcess.prototype.trySellResources = function (resourceType, rooms) {
	const npcPrice = 1;

	if (_.filter(Game.market.orders, order => order.type === ORDER_SELL && order.resourceType === resourceType).length > 0) {
		return;
	}

	// Find room with highest amount of this resource.
	const roomName = this.getHighestResourceState(resourceType, rooms);
	if (!roomName) return;

	// Find comparable deals for selling this resource.
	const bestBuyOrder = this.findBestBuyOrder(resourceType, roomName);
	const bestSellOrder = this.findBestSellOrder(resourceType, roomName);

	let offerPrice;
	if (bestBuyOrder && bestSellOrder) {
		hivemind.log('trade', roomName).info(resourceType, 'is currently being bought for', bestBuyOrder.price, 'and sold for', bestSellOrder.price, 'credits.');
		offerPrice = Math.max(bestBuyOrder.price / 0.9, bestSellOrder.price / 0.9);
	}
	else if (bestSellOrder) {
		// Nobody is buying this resource, so adapt to the current sell price.
		hivemind.log('trade', roomName).info(resourceType, 'is currently being sold for', bestSellOrder.price);
		offerPrice = bestSellOrder.price / 0.9;
	}
	else {
		// Nobody is selling this resource, try to get a greedy price for it.
		hivemind.log('trade', roomName).info('Nobody else is currently selling', resourceType);
		offerPrice = npcPrice * 5;
	}

	hivemind.log('trade', roomName).debug('Offering to sell for', offerPrice);

	// Make sure we have enough credits to actually sell this.
	if (Game.market.credits < 10000 * offerPrice * 0.05) return;

	Game.market.createOrder(ORDER_SELL, resourceType, offerPrice, 10000, roomName);
};

/**
 * Finds the room in a list that has the lowest amount of a resource.
 *
 * @param {string} resourceType
 *   The type of resource to trade.
 * @param {object} rooms
 *   Resource states for rooms to check, keyed by room name.
 *
 * @return {string}
 *   Name of the room with the lowest resource amount.
 */
TradeProcess.prototype.getLowestResourceState = function (resourceType, rooms) {
	let minAmount;
	let bestRoom;
	_.each(rooms, (roomState, roomName) => {
		if (!roomState.canTrade) return;
		if (Game.rooms[roomName] && Game.rooms[roomName].isFullOn(resourceType)) return;
		if (!minAmount || (roomState.totalResources[resourceType] || 0) < minAmount) {
			minAmount = roomState.totalResources[resourceType];
			bestRoom = roomName;
		}
	});

	return bestRoom;
};

/**
 * Finds the room in a list that has the highest amount of a resource.
 *
 * @param {string} resourceType
 *   The type of resource to trade.
 * @param {object} rooms
 *   Resource states for rooms to check, keyed by room name.
 *
 * @return {string}
 *   Name of the room with the highest resource amount.
 */
TradeProcess.prototype.getHighestResourceState = function (resourceType, rooms) {
	let maxAmount;
	let bestRoom;
	_.each(rooms, (roomState, roomName) => {
		if (!roomState.canTrade) return;
		if (!maxAmount || (roomState.totalResources[resourceType] || 0) > maxAmount) {
			maxAmount = roomState.totalResources[resourceType];
			bestRoom = roomName;
		}
	});

	return bestRoom;
};

/**
 * Finds best buy order of another player to sell a certain resource.
 *
 * @param {string} resourceType
 *   The type of resource to trade.
 * @param {object} roomName
 *   Name of the room that serves as a base for this transaction.
 *
 * @return {object}
 *   The order as returned from Game.market.
 */
TradeProcess.prototype.findBestBuyOrder = function (resourceType, roomName) {
	// Find best deal for selling this resource.
	const orders = Game.market.getAllOrders(order => order.type === ORDER_BUY && order.resourceType === resourceType);

	let maxScore;
	let bestOrder;
	_.each(orders, order => {
		if (order.amount < 100) return;
		const transactionCost = Game.market.calcTransactionCost(1000, roomName, order.roomName);
		const credits = 1000 * order.price;
		const score = credits - (0.3 * transactionCost);

		if (!maxScore || score > maxScore) {
			maxScore = score;
			bestOrder = order;
		}
	});

	return bestOrder;
};

/**
 * Finds best sell order of another player to buy a certain resource.
 *
 * @param {string} resourceType
 *   The type of resource to trade.
 * @param {object} roomName
 *   Name of the room that serves as a base for this transaction.
 *
 * @return {object}
 *   The order as returned from Game.market.
 */
TradeProcess.prototype.findBestSellOrder = function (resourceType, roomName) {
	// Find best deal for buying this resource.
	const orders = Game.market.getAllOrders(order => order.type === ORDER_SELL && order.resourceType === resourceType);

	let minScore;
	let bestOrder;
	_.each(orders, order => {
		if (order.amount < 100) return;
		const transactionCost = Game.market.calcTransactionCost(1000, roomName, order.roomName);
		const credits = 1000 * order.price;
		const score = credits + (0.3 * transactionCost);

		if (!minScore || score < minScore) {
			minScore = score;
			bestOrder = order;
		}
	});

	return bestOrder;
};

/**
 * Removes outdated orders from the market.
 */
TradeProcess.prototype.removeOldTrades = function () {
	_.each(Game.market.orders, order => {
		const age = Game.time - order.created;

		if (age > 100000 || order.remainingAmount < 100) {
			// Nobody seems to be buying or selling this order, cancel it.
			hivemind.log('trade', order.roomName).debug('Cancelling old trade', order.type + 'ing', order.remainingAmount, order.resourceType, 'for', order.price, 'each after', age, 'ticks.');
			Game.market.cancelOrder(order.id);
		}
	});
};

/**
 * Assigns a "tier" to a resource, giving it a base value.
 *
 * @param {string} resourceType
 *   The type of resource to check.
 *
 * @return {number}
 *   The general trade value we assign the given resource.
 */
TradeProcess.prototype.getResourceTier = function (resourceType) {
	if (resourceType === RESOURCE_ENERGY) return 0;
	if (resourceType === RESOURCE_POWER) return 10;

	const tier = resourceType.length;
	if (resourceType.indexOf('G') !== -1) {
		return tier + 3;
	}

	return tier;
};

module.exports = TradeProcess;
