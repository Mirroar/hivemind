/* global RESOURCES_ALL RESOURCE_ENERGY RESOURCE_POWER OK RESOURCE_OPS
ORDER_BUY ORDER_SELL PIXEL STORAGE_CAPACITY INTERSHARD_RESOURCES
REACTION_TIME */

import Process from 'process/process';
import cache from 'utils/cache';

import utilities from 'utilities';

// Minimum value for a trade. Would be cool if this was a game constant.
const minTradeValue = 0.001;
// Amount of credits to keep in reserve for creating orders.
const creditReserve = 10_000;
// Lookup for lab reaction recipes.
const recipes = utilities.getReactionRecipes();

/**
 * Automatically trades resources on the open market.
 */
export default class TradeProcess extends Process {
	availableCredits: number;

	/**
	 * Buys and sells resources on the global market.
	 */
	run() {
		if (!hivemind.settings.get('enableTradeManagement')) return;

		// Only trade if we have a terminal to trade with.
		if (_.size(_.filter(Game.myRooms, room => room.terminal)) === 0) return;

		this.removeOldTrades();

		this.availableCredits = Math.max(0, Game.market.credits - creditReserve);

		const resources = this.getRoomResourceStates();
		const total = resources.total;
		const maxStorage = total.rooms * STORAGE_CAPACITY / 20;
		const highStorage = total.rooms * STORAGE_CAPACITY / 50;
		const lowStorage = total.rooms * Math.min(STORAGE_CAPACITY / 100, 20_000);
		const minStorage = total.rooms * Math.min(STORAGE_CAPACITY / 200, 10_000);

		for (const resourceType of RESOURCES_ALL) {
			const tier = this.getResourceTier(resourceType);

			if (tier === 1) {
				// Check for base resources we have too much of.
				if ((total.resources[resourceType] || 0) > maxStorage) {
					this.instaSellResources(resourceType, resources.rooms);
				}

				if ((total.resources[resourceType] || 0) > highStorage) {
					this.trySellResources(resourceType, resources.rooms);
				}

				// Check for base resources we're missing.
				if ((total.resources[resourceType] || 0) < lowStorage && this.availableCredits > 0) {
					this.tryBuyResources(resourceType, resources.rooms);
				}

				if ((total.resources[resourceType] || 0) < minStorage && this.availableCredits > 0) {
					this.instaBuyResources(resourceType, resources.rooms);
				}
			}
			else if (recipes[resourceType]) {
				// Check if we can make a nice profit selling some boost compounds.
				const resourceWorth = this.calculateWorth(resourceType);
				if (resourceWorth) {
					const history = this.getPriceData(resourceType);
					if (history && history.average && history.average > resourceWorth) {
						// Alright, looks like we can make a profit by selling this!
						if ((total.resources[resourceType] || 0) > minStorage) {
							this.instaSellResources(resourceType, resources.rooms);
						}

						if ((total.resources[resourceType] || 0) > minStorage) {
							this.trySellResources(resourceType, resources.rooms);
						}
					}
				}
			}
		}

		if (this.availableCredits > 0 && hivemind.settings.get('allowBuyingEnergy')) {
			// Also try to cheaply buy some energy for rooms that are low on it.
			_.each(resources.rooms, (roomState: any, roomName: string) => {
				if (!roomState.canTrade) return;
				if (roomState.isEvacuating) return;
				if ((roomState.totalResources[RESOURCE_ENERGY] || 0) > STORAGE_CAPACITY / 10) return;

				// @todo Force creating a buy order for every affected room.
				const temp = {
					[roomName]: roomState,
				};
				this.tryBuyResources(RESOURCE_ENERGY, temp, true);
			});
		}

		if (this.availableCredits > 0 && hivemind.settings.get('allowBuyingPixels')) {
			// Try to buy pixels when price is low.
			this.tryBuyResources(PIXEL);
			this.instaBuyResources(PIXEL);
		}

		if (hivemind.settings.get('allowSellingPower')) {
			// Sell excess power we can't apply to our account.
			if ((total.resources[RESOURCE_POWER] || 0) > highStorage) {
				this.instaSellResources(RESOURCE_POWER, resources.rooms);
			}

			if ((total.resources[RESOURCE_POWER] || 0) > lowStorage) {
				this.trySellResources(RESOURCE_POWER, resources.rooms);
			}
		}

		if (hivemind.settings.get('allowSellingOps')) {
			// Sell excess ops.
			if ((total.resources[RESOURCE_OPS] || 0) > lowStorage) {
				this.instaSellResources(RESOURCE_OPS, resources.rooms);
			}

			if ((total.resources[RESOURCE_OPS] || 0) > minStorage) {
				this.trySellResources(RESOURCE_OPS, resources.rooms);
			}
		}
	}

	/**
	 * Determines the amount of available resources in each room.
	 *
	 * @return {object}
	 *   An object containing the following keys:
	 *   - rooms: An array of objects containing resource states for each room.
	 *   - roral: Sum of all resource levels of each room.
	 */
	getRoomResourceStates() {
		const rooms = {};
		const total = {
			resources: {},
			sources: {},
			rooms: 0,
		};

		for (const room of Game.myRooms) {
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
	}

	/**
	 * Tries to find a reasonable buy order for instantly getting rid of some resources.
	 *
	 * @param {string} resourceType
	 *   The type of resource to trade.
	 * @param {object} rooms
	 *   Resource states for rooms to check, keyed by room name.
	 */
	instaSellResources(resourceType, rooms) {
		// Find room with highest amount of this resource.
		const roomName = this.getHighestResourceState(resourceType, rooms);
		if (!roomName) return;

		const room = Game.rooms[roomName];

		const bestOrder = this.findBestBuyOrder(resourceType, roomName);
		const history = this.getPriceData(resourceType);
		if (!bestOrder) return;
		if (!history) return;

		const minPrice = history.average + (history.stdDev / 2);
		hivemind.log('trade', roomName).debug('Could sell', resourceType, 'for', bestOrder.price, '- we want at least', minPrice);
		if (bestOrder.price < minPrice) return;

		const amount = Math.min(this.getMaxOrderAmount(resourceType), bestOrder.amount);
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
	}

	/**
	 * Tries to find a reasonable sell order for instantly acquiring some resources.
	 *
	 * @param {string} resourceType
	 *   The type of resource to trade.
	 * @param {object} rooms
	 *   Resource states for rooms to check, keyed by room name.
	 */
	instaBuyResources(resourceType, rooms?: any) {
		const isIntershardResource = INTERSHARD_RESOURCES.includes(resourceType);

		// Find room with lowest amount of this resource.
		const roomName = isIntershardResource ? null : this.getLowestResourceState(resourceType, rooms);
		if (!roomName && !isIntershardResource) return;

		const room = Game.rooms[roomName];

		const bestOrder = this.findBestSellOrder(resourceType, roomName);
		const history = this.getPriceData(resourceType);
		if (!bestOrder) return;
		if (!history) return;

		const maxPrice = history.average - Math.min(history.stdDev / 5, history.average * 0.1);
		hivemind.log('trade', roomName).debug('Could buy', resourceType, 'for', bestOrder.price, '- we want to spend at most', maxPrice);
		if (bestOrder.price > maxPrice) return;

		const amount = Math.min(this.getMaxOrderAmount(resourceType), bestOrder.amount);
		if (isIntershardResource) {
			hivemind.log('trade', roomName).info('Buying', amount, resourceType, 'from', bestOrder.roomName, 'for', bestOrder.price, 'credits each.');
		}
		else {
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

			hivemind.log('trade', roomName).info('Buying', amount, resourceType, 'from', bestOrder.roomName, 'for', bestOrder.price, 'credits each, costing', transactionCost, 'energy.');
		}

		const result = Game.market.deal(bestOrder.id, amount, roomName);
		if (result !== OK) {
			hivemind.log('trade', roomName).info('Transaction failed:', result);
		}
	}

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
	tryBuyResources(resourceType, rooms?: any, ignoreOtherRooms?: boolean) {
		const isIntershardResource = INTERSHARD_RESOURCES.includes(resourceType);

		if (_.some(Game.market.orders, order => {
			if (order.type === ORDER_BUY && order.resourceType === resourceType) {
				if (ignoreOtherRooms && !rooms[order.roomName]) {
					return false;
				}

				return true;
			}

			return false;
		})) {
			return;
		}

		// Find room with lowest amount of this resource.
		const roomName = isIntershardResource ? null : this.getLowestResourceState(resourceType, rooms);
		if (!roomName && !isIntershardResource) return;

		// Find comparable deals for buying this resource.
		const bestBuyOrder = this.findBestBuyOrder(resourceType, roomName);
		const history = this.getPriceData(resourceType);
		if (!history) return;

		const maxPrice = history.average - Math.min(history.stdDev / 2, history.average * 0.2);
		let offerPrice = maxPrice;
		if (bestBuyOrder) {
			// Adapt to the current buy price, if it's to our benefit.
			hivemind.log('trade', roomName).info(resourceType, 'is currently being bought for', bestBuyOrder.price);
			offerPrice = Math.min(offerPrice, bestBuyOrder.price * 1.01);
		}
		else {
			// Nobody is buying this resource, try to get it for very cheap.
			hivemind.log('trade', roomName).info('Nobody else is currently buying', resourceType);
			offerPrice = history.average - Math.min(history.stdDev, history.average * 0.8);
		}

		hivemind.log('trade', roomName).debug('Could offer to buy', resourceType, 'for', offerPrice, '- we want to spend at most', maxPrice);
		if (offerPrice > maxPrice) return;

		if (offerPrice < minTradeValue) offerPrice = minTradeValue;

		const amount = this.getMaxOrderAmount(resourceType);

		// Make sure we have enough credits to actually buy this.
		if (this.availableCredits < amount * offerPrice) return;

		hivemind.log('trade', roomName).debug('Offering to buy for', offerPrice);

		const result = Game.market.createOrder({
			type: ORDER_BUY,
			resourceType,
			price: offerPrice,
			totalAmount: amount,
			roomName,
		});
		if (result !== OK) {
			hivemind.log('trade', roomName).error('Could not create buy order:', result);
		}
	}

	/**
	 * Creates a sell order at a reasonable price.
	 *
	 * @param {string} resourceType
	 *   The type of resource to trade.
	 * @param {object} rooms
	 *   Resource states for rooms to check, keyed by room name.
	 */
	trySellResources(resourceType, rooms) {
		if (_.some(Game.market.orders, order => order.type === ORDER_SELL && order.resourceType === resourceType)) {
			return;
		}

		// Find room with highest amount of this resource.
		const roomName = this.getHighestResourceState(resourceType, rooms);
		if (!roomName) return;

		// Find comparable deals for selling this resource.
		const bestSellOrder = this.findBestSellOrder(resourceType, roomName);
		const history = this.getPriceData(resourceType);
		if (!history) return;

		const minPrice = history.average + (history.stdDev / 2);
		let offerPrice = minPrice;
		if (bestSellOrder) {
			// Adapt to the current sale price if it's to our benefit.
			hivemind.log('trade', roomName).info(resourceType, 'is currently being sold for', bestSellOrder.price);
			offerPrice = Math.min(Math.max(offerPrice, bestSellOrder.price * 0.99), (history.average * 1.5) + (history.stdDev * 2));
		}
		else {
			// Nobody is selling this resource, try to get a greedy price for it.
			hivemind.log('trade', roomName).info('Nobody else is currently selling', resourceType);
			offerPrice = (history.average * 1.5) + (history.stdDev * 2);
		}

		hivemind.log('trade', roomName).debug('Could offer to sell', resourceType, 'for', offerPrice, '- we want at least', minPrice);
		if (offerPrice < minPrice) return;

		const amount = this.getMaxOrderAmount(resourceType);
		// Make sure we have enough credits to actually sell this, otherwise try
		// filling other player's orders.
		if (Game.market.credits < amount * offerPrice * 0.05) {
			this.instaSellResources(resourceType, rooms);
			return;
		}

		hivemind.log('trade', roomName).debug('Offering to sell for', offerPrice);

		Game.market.createOrder({
			type: ORDER_SELL,
			resourceType,
			price: offerPrice,
			totalAmount: amount,
			roomName,
		});
	}

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
	getLowestResourceState(resourceType, rooms) {
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
	}

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
	getHighestResourceState(resourceType, rooms) {
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
	}

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
	findBestBuyOrder(resourceType, roomName) {
		// Find best deal for selling this resource.
		const orders = Game.market.getAllOrders(order => order.type === ORDER_BUY && order.resourceType === resourceType);

		let maxScore;
		let bestOrder;
		_.each(orders, order => {
			if (order.amount < 100) return;
			const transactionCost = !INTERSHARD_RESOURCES.includes(resourceType) ? Game.market.calcTransactionCost(1000, roomName, order.roomName) : 0;
			const credits = 1000 * order.price;
			const score = credits - (0.3 * transactionCost);

			if (!maxScore || score > maxScore) {
				maxScore = score;
				bestOrder = order;
			}
		});

		return bestOrder;
	}

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
	findBestSellOrder(resourceType, roomName) {
		// Find best deal for buying this resource.
		const orders = Game.market.getAllOrders(order => order.type === ORDER_SELL && order.resourceType === resourceType);

		let minScore;
		let bestOrder;
		_.each(orders, order => {
			if (order.amount < 100) return;
			const transactionCost = !INTERSHARD_RESOURCES.includes(resourceType) ? Game.market.calcTransactionCost(1000, roomName, order.roomName) : 0;
			const credits = 1000 * order.price;
			const score = credits + (0.3 * transactionCost);

			if (!minScore || score < minScore) {
				minScore = score;
				bestOrder = order;
			}
		});

		return bestOrder;
	}

	/**
	 * Removes outdated orders from the market.
	 */
	removeOldTrades() {
		_.each(Game.market.orders, order => {
			const age = Game.time - order.created;

			if (age > 100_000 || order.remainingAmount === 0) {
				// Nobody seems to be buying or selling this order, cancel it.
				hivemind.log('trade', order.roomName).debug('Cancelling old trade', order.type + 'ing', order.remainingAmount, order.resourceType, 'for', order.price, 'each after', age, 'ticks.');
				Game.market.cancelOrder(order.id);
			}
		});
	}

	/**
	 * Assigns a "tier" to a resource, giving it a base value.
	 *
	 * @param {string} resourceType
	 *   The type of resource to check.
	 *
	 * @return {number}
	 *   The general trade value we assign the given resource.
	 */
	getResourceTier(resourceType) {
		if (resourceType === RESOURCE_ENERGY) return 0;
		if (resourceType === RESOURCE_POWER) return 10;

		const tier = resourceType.length;
		if (resourceType.includes('G')) {
			return tier + 3;
		}

		return tier;
	}

	/**
	 * Decides how much resource should be traded at once.
	 *
	 * This is to make sure we don't pay huge amounts on market fees for trades
	 * that will never be completed.
	 *
	 * @param {String} resourceType
	 *   The resource type for which we need information.
	 *
	 * @return {Number}
	 *   Maximum amount of this resource to trade in a single transaction.
	 */
	getMaxOrderAmount(resourceType) {
		const history = this.getPriceData(resourceType);
		if (!history) return 0;

		if (history.average < 10 && history.total > 10_000) return 10_000;
		if (history.average < 100 && history.total > 1000) return 1000;
		if (history.average < 1000 && history.total > 100) return 100;
		if (history.average < 10_000 && history.total > 10) return 10;

		return 1;
	}

	/**
	 * Analyzes market history to decide on resource price.
	 *
	 * @param {String} resourceType
	 *   The resource type for which we need information.
	 *
	 * @return {Object}
	 *  An object with price data containing the following keys:
	 *  - total: Amount of this resource traded recently.
	 *  - average: Adjusted average price of this resource.
	 *  - stdDev: Adjusted standard deviation for this resource's price.
	 */
	getPriceData(resourceType) {
		return cache.inHeap('price:' + resourceType, 5000, () => {
			const history = Game.market.getHistory(resourceType);

			// There needs to be a few days of price data before we consider dealing.
			if (history.length < 4) return null;

			// Find days with highest and lowest deal values.
			const minDay = _.min(history, 'avgPrice');
			const maxDay = _.max(history, 'avgPrice');
			const maxDev = _.max(history, 'stddevPrice');

			let count = 0;
			let totalValue = 0;
			let totalDev = 0;
			_.each(history, day => {
				// Skip days with highest and lowest deal values as outliers.
				if (day.date === minDay.date) return;
				if (day.date === maxDay.date) return;
				if (day.date === maxDev.date) return;
				if (day.resourceType !== resourceType) return;

				count += day.volume;
				totalValue += day.volume * day.avgPrice;
				totalDev += day.volume * day.stddevPrice;
			});

			return {
				total: count,
				average: totalValue / count,
				stdDev: totalDev / count,
			};
		});
	}

	/**
	 * Calculates estimated worth of lab reaction compounds.
	 *
	 * @param {String} resourceType
	 *   The resource type for which we need information.
	 *
	 * @return {Number}
	 *   Estimated worth of the given resource in credits.
	 */
	calculateWorth(resourceType) {
		return cache.inHeap('resourceWorth:' + resourceType, 5000, () => {
			const history = this.getPriceData(resourceType);
			if (!recipes[resourceType]) {
				return history ? history.average : 0;
			}

			const reagentWorth = _.reduce(recipes[resourceType], (total, componentType) => {
				const componentWorth = this.calculateWorth(componentType);
				const componentHistory = this.getPriceData(componentType);
				return total + Math.max(componentWorth, componentHistory ? componentHistory.average : 0);
			}, 0);

			// Add 0.1% to price for each tick needed to produce this reagent.
			return reagentWorth * (1 + (0.001 * (REACTION_TIME[resourceType] || 0)));
		});
	}
}
