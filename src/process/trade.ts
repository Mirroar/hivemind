/* global RESOURCES_ALL RESOURCE_ENERGY RESOURCE_POWER OK RESOURCE_OPS
ORDER_BUY ORDER_SELL PIXEL STORAGE_CAPACITY INTERSHARD_RESOURCES
REACTION_TIME */

import cache from 'utils/cache';
import hivemind from 'hivemind';
import Process from 'process/process';
import utilities from 'utilities';
import {ENEMY_STRENGTH_NORMAL} from 'room-defense';
import {getResourcesIn} from 'utils/store';
import container from 'utils/container';

// Minimum value for a trade. Would be cool if this was a game constant.
const minTradeValue = 0.001;
// Amount of credits to keep in reserve for creating orders.
const creditReserve = 10_000;
// Lookup for lab reaction recipes.
const recipes = utilities.getReactionRecipes();

type TradeResource = ResourceConstant | InterShardResourceConstant;

type TotalResources = {
	rooms: number;
	resources: Partial<Record<ResourceConstant, number>>;
	sources: Partial<Record<ResourceConstant, number>>;
};

type ResourceStates = {
	rooms: Record<string, RoomResourceState>;
	total: TotalResources;
};

function isIntershardResource(resourceType: TradeResource): resourceType is InterShardResourceConstant {
	return (INTERSHARD_RESOURCES as string[]).includes(resourceType);
}

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
		this.manageTradeOrders();
	}

	manageTradeOrders() {
		const resources = this.getRoomResourceStates();
		this.manageLabResourceTradeOrders(resources);
		this.manageEnergyTradeOrders(resources);
		this.managePowerTradeOrders(resources);
		this.manageOpsTradeOrders(resources);
		this.manageCommodityTradeOrders(resources);
		this.manageOverflowingTerminals(resources);

		if (this.availableCredits > 0 && hivemind.settings.get('allowBuyingPixels')) {
			// Try to buy pixels when price is low.
			this.tryBuyResources(PIXEL);
			this.instaBuyResources(PIXEL);
		}
	}

	manageLabResourceTradeOrders(resources: ResourceStates) {
		for (const resourceType of RESOURCES_ALL) {
			const tier = this.getResourceTier(resourceType);

			if (tier === 1) {
				this.manageTier1ResourceTradeOrder(resourceType, resources);
			}
			else if (recipes[resourceType]) {
				this.manageCompoundResourceTradeOrder(resourceType, resources);
			}
		}
	}

	manageTier1ResourceTradeOrder(resourceType: ResourceConstant, resources: ResourceStates) {
		const total = resources.total;
		const maxStorage = total.rooms * STORAGE_CAPACITY / 20;
		const highStorage = total.rooms * STORAGE_CAPACITY / 50;
		const lowStorage = total.rooms * Math.min(STORAGE_CAPACITY / 100, 20_000);
		const minStorage = total.rooms * Math.min(STORAGE_CAPACITY / 200, 10_000);

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
			this.instaBuyResources(resourceType, resources.rooms, true);
		}
	}

	manageCompoundResourceTradeOrder(resourceType: ResourceConstant, resources: ResourceStates) {
		// Check if we can make a nice profit selling some boost compounds.
		const resourceWorth = this.calculateWorth(resourceType);
		if (!resourceWorth) return;

		const total = resources.total;
		const minStorage = total.rooms * Math.min(STORAGE_CAPACITY / 200, 10_000);

		const history = this.getPriceData(resourceType);
		if (history?.average && history.average > resourceWorth) {
			// Alright, looks like we can make a profit by selling this!
			if ((total.resources[resourceType] || 0) > minStorage) {
				this.instaSellResources(resourceType, resources.rooms);
			}

			if ((total.resources[resourceType] || 0) > minStorage) {
				this.trySellResources(resourceType, resources.rooms);
			}
		}
	}

	manageEnergyTradeOrders(resources: ResourceStates) {
		if (this.availableCredits > 0 && hivemind.settings.get('allowBuyingEnergy')) {
			// Buy energy for rooms under attack so we can hold out longer.
			for (const room of Game.myRooms) {
				if (room.getEffectiveAvailableEnergy() < 30_000 && room.defense.getEnemyStrength() >= ENEMY_STRENGTH_NORMAL) {
					if (room.factory && room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) > 500) {
						this.instaBuyResources(RESOURCE_BATTERY, {[room.name]: resources.rooms[room.name]}, true);
					}
					else {
						this.instaBuyResources(RESOURCE_ENERGY, {[room.name]: resources.rooms[room.name]}, true);
					}
				}
			}

			// Also try to cheaply buy some energy for rooms that are low on it.
			_.each(resources.rooms, (roomState, roomName) => {
				if (!roomState.canTrade) return;
				if (roomState.isEvacuating) return;
				if ((roomState.totalResources[RESOURCE_ENERGY] || 0) > STORAGE_CAPACITY / 10) return;

				// @todo Force creating a buy order for every affected room.
				const temporary = {
					[roomName]: roomState,
				};
				this.tryBuyResources(RESOURCE_ENERGY, temporary, true);
			});
		}
	}

	managePowerTradeOrders(resources: ResourceStates) {
		if (!hivemind.settings.get('allowSellingPower')) return;

		const total = resources.total;
		const highStorage = total.rooms * STORAGE_CAPACITY / 50;
		const lowStorage = total.rooms * Math.min(STORAGE_CAPACITY / 100, 20_000);

		// Sell excess power we can't apply to our account.
		if ((total.resources[RESOURCE_POWER] || 0) > highStorage) {
			this.instaSellResources(RESOURCE_POWER, resources.rooms);
		}

		if ((total.resources[RESOURCE_POWER] || 0) > lowStorage) {
			this.trySellResources(RESOURCE_POWER, resources.rooms);
		}
	}

	manageOpsTradeOrders(resources: ResourceStates) {
		if (!hivemind.settings.get('allowSellingOps')) return;

		const total = resources.total;
		const lowStorage = total.rooms * Math.min(STORAGE_CAPACITY / 100, 20_000);
		const minStorage = total.rooms * Math.min(STORAGE_CAPACITY / 200, 10_000);

		// Sell excess ops.
		if ((total.resources[RESOURCE_OPS] || 0) > lowStorage) {
			this.instaSellResources(RESOURCE_OPS, resources.rooms);
		}

		if ((total.resources[RESOURCE_OPS] || 0) > minStorage) {
			this.trySellResources(RESOURCE_OPS, resources.rooms);
		}
	}

	manageCommodityTradeOrders(resources: ResourceStates) {
		const resourceManager = container.get('ResourceLevelManager');

		for (const resourceType of RESOURCES_ALL) {
			if (!resourceManager.isCommodityResource(resourceType) && !resourceManager.isDepositResource(resourceType)) continue;

			// If we can upgrade this commodity, don't sell it.
			if (this.canUpgradeCommodity(resourceType)) continue;

			// Sell what we can.
			const total = resources.total;
			if ((total.resources[resourceType] || 0) === 0) continue;

			if ((total.resources[resourceType] || 0) > 0) {
				this.instaSellResources(resourceType, resources.rooms);
			}
		}
	}

	getPowerCreepFactoryLevels(): number[] {
		return cache.inHeap('power-creep-factory-levels', 1000, () => {
			const levels: number[] = [];
			for (const powerCreep of Object.values(Game.powerCreeps)) {
				if (!powerCreep.ticksToLive) continue;
				if (powerCreep.shard !== Game.shard.name) continue;
				if (!powerCreep.powers[PWR_OPERATE_FACTORY]) continue;
				
				if (!levels.includes(powerCreep.powers[PWR_OPERATE_FACTORY].level)) levels.push(powerCreep.powers[PWR_OPERATE_FACTORY].level);
			}

			return levels;
		});
	}

	getCommodityUpgradeLevels() {
		return cache.inHeap('commodity-upgrade-levels', 100_000, () => {
			const levels: Partial<Record<CommoditiesTypes, number[]>> = {};
			const resourceManager = container.get('ResourceLevelManager');

			for (const [, commodity] of Object.entries(COMMODITIES)) {
				if (!commodity.level) continue;

				for (const component of getResourcesIn(commodity.components)) {
					if (!resourceManager.isCommodityResource(component)) continue;
					if (!levels[component]) levels[component] = [];
					if (!levels[component].includes(commodity.level)) levels[component].push(commodity.level);
				}
			}

			return levels;
		});
	}

	canUpgradeCommodity(resourceType: ResourceConstant) {
		const upgradeLevels = this.getCommodityUpgradeLevels();
		if (!upgradeLevels[resourceType]) return false;

		const factoryLevels = this.getPowerCreepFactoryLevels();

		return factoryLevels.some(level => upgradeLevels[resourceType].includes(level));
	}

	manageOverflowingTerminals(resources: ResourceStates) {
		// Check for terminals with too much of a resource.
		for (const room of Game.myRooms) {
			if (!room.terminal) continue;
			if (room.storage && room.storage.store.getFreeCapacity() > room.storage.store.getCapacity() * 0.1) continue;
			if (room.terminal.store.getFreeCapacity() >= room.terminal.store.getCapacity() * 0.05) continue;

			const mostValuableResource = this.getMostValuableResource(room);
			if (!mostValuableResource) continue;

			this.instaSellResources(mostValuableResource, {[room.name]: resources.rooms[room.name]});
		}
	}

	getMostValuableResource(room: Room): ResourceConstant {
		const store = room.terminal.store;
		let bestResource: ResourceConstant;
		let bestValue = 0;
		for (const resourceType of getResourcesIn(store)) {
			if (resourceType === RESOURCE_ENERGY) continue;

			const worth = this.calculateWorth(resourceType);
			const bestOrder = this.findBestBuyOrder(resourceType, room.name);
			if (!bestOrder) continue;

			const value = bestOrder.price / worth;

			if (value > bestValue) {
				bestValue = value;
				bestResource = resourceType;
			}
		}

		return bestResource;
	}

	/**
	 * Determines the amount of available resources in each room.
	 *
	 * @return {object}
	 *   An object containing the following keys:
	 *   - rooms: An array of objects containing resource states for each room.
	 *   - roral: Sum of all resource levels of each room.
	 */
	getRoomResourceStates(): ResourceStates {
		const rooms = {};
		const total: TotalResources = {
			resources: {},
			sources: {},
			rooms: 0,
		};

		for (const room of Game.myRooms) {
			const roomData = room.getResourceState();
			if (!roomData) continue;

			total.rooms++;
			for (const resourceType of getResourcesIn(roomData.totalResources)) {
				total.resources[resourceType] = (total.resources[resourceType] || 0) + roomData.totalResources[resourceType];
			}

			for (const mineralType of roomData.mineralTypes) {
				total.sources[mineralType] = (total.sources[mineralType] || 0) + 1;
			}

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
	instaSellResources(resourceType: ResourceConstant, rooms: Record<string, RoomResourceState>) {
		// Find room with highest amount of this resource.
		const roomName = this.getRoomHighestOn(resourceType, rooms);
		if (!roomName) return;

		const room = Game.rooms[roomName];

		const bestOrder = this.findBestBuyOrder(resourceType, roomName);
		const history = this.getPriceData(resourceType);
		if (!bestOrder) return;
		if (!history) return;

		const minPrice = history.average + (history.stdDev / 2);
		hivemind.log('trade', roomName).debug('Could sell', resourceType, 'for', bestOrder.price, '- we want at least', minPrice);
		if (bestOrder.price < minPrice) return;

		const amount = Math.min(this.getMaxOrderAmount(resourceType), bestOrder.amount, room.getCurrentResourceAmount(resourceType));
		if (amount === 0) return;
		
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
	instaBuyResources(resourceType: TradeResource, rooms?: Record<string, RoomResourceState>, force?: boolean) {
		// Find room with lowest amount of this resource.
		const roomName = isIntershardResource(resourceType) ? null : this.getRoomLowestOn(resourceType, rooms);
		if (!roomName && !isIntershardResource(resourceType)) return;

		const room = Game.rooms[roomName];

		const bestOrder = this.findBestSellOrder(resourceType, roomName);
		if (!bestOrder) return;

		const history = this.getPriceData(resourceType);
		if (!history) return;

		const maxPrice = history.average - Math.min(history.stdDev / 5, history.average * 0.1);
		hivemind.log('trade', roomName).debug('Could buy', resourceType, 'for', bestOrder.price, '- we want to spend at most', maxPrice);
		if (bestOrder.price > maxPrice && !force) return;

		let amount = Math.min(force ? 10_000 : this.getMaxOrderAmount(resourceType), bestOrder.amount);
		if (isIntershardResource(resourceType)) {
			hivemind.log('trade', roomName).info('Buying', amount, resourceType, 'from', bestOrder.roomName, 'for', bestOrder.price, 'credits each.');
		}
		else {
			let transactionCost = Game.market.calcTransactionCost(amount, roomName, bestOrder.roomName);

			if (transactionCost > room.terminal.store.energy) {
				if (room.memory.fillTerminal) {
					hivemind.log('trade', roomName).info('Busy, can\'t prepare', transactionCost, 'energy for buying', amount, resourceType);
				}
				else {
					room.prepareForTrading(RESOURCE_ENERGY, transactionCost);
					hivemind.log('trade', roomName).info('Preparing', transactionCost, 'energy for buying', amount, resourceType, 'from', bestOrder.roomName, 'at', bestOrder.price, 'credits each');
				}

				if (force) {
					amount = Math.floor(amount * room.terminal.store.energy / transactionCost);
					transactionCost = Game.market.calcTransactionCost(amount, roomName, bestOrder.roomName);
				}
				else return;
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
	tryBuyResources(resourceType: TradeResource, rooms?: Record<string, RoomResourceState>, ignoreOtherRooms?: boolean) {
		if (!hivemind.settings.get('enableCreatingTradeOrders')) return;

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
		const roomName = isIntershardResource(resourceType) ? null : this.getRoomLowestOn(resourceType, rooms);
		if (!roomName && !isIntershardResource(resourceType)) return;

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
	trySellResources(resourceType: ResourceConstant, rooms: Record<string, RoomResourceState>) {
		if (!hivemind.settings.get('enableCreatingTradeOrders')) return;

		if (_.some(Game.market.orders, order => order.type === ORDER_SELL && order.resourceType === resourceType)) {
			return;
		}

		// Find room with highest amount of this resource.
		const roomName = this.getRoomHighestOn(resourceType, rooms);
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
	getRoomLowestOn(resourceType: ResourceConstant, rooms: Record<string, RoomResourceState>): string {
		let minAmount: number;
		let bestRoom: string;
		_.each(rooms, (roomState: RoomResourceState, roomName: string) => {
			if (!roomState.canTrade) return;
			if (Game.rooms[roomName]?.isFullOn(resourceType)) return;
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
	getRoomHighestOn(resourceType: ResourceConstant, rooms: Record<string, RoomResourceState>): string {
		let maxAmount: number;
		let bestRoom: string;
		_.each(rooms, (roomState: RoomResourceState, roomName: string) => {
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
	findBestBuyOrder(resourceType: TradeResource, roomName: string): Order {
		// Find best deal for selling this resource.
		const orders = Game.market.getAllOrders(order => order.type === ORDER_BUY && order.resourceType === resourceType);

		let maxScore: number;
		let bestOrder: Order;
		_.each(orders, order => {
			if (order.amount < 100) return;
			const transactionCost = isIntershardResource(resourceType) ? 0 : Game.market.calcTransactionCost(1000, roomName, order.roomName);
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
	findBestSellOrder(resourceType: TradeResource, roomName: string): Order {
		// Find best deal for buying this resource.
		const orders = Game.market.getAllOrders(order => order.type === ORDER_SELL && order.resourceType === resourceType);

		let minScore: number;
		let bestOrder: Order;
		_.each(orders, order => {
			if (order.amount < 100) return;
			const transactionCost = isIntershardResource(resourceType) ? 0 : Game.market.calcTransactionCost(1000, roomName, order.roomName);
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
	getResourceTier(resourceType: ResourceConstant) {
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
	getMaxOrderAmount(resourceType: TradeResource): number {
		const history = this.getPriceData(resourceType);
		if (!history) return 0;

		// if (history.average < 10 && history.total > 10_000) return 10_000;
		// if (history.average < 100 && history.total > 1000) return 1000;
		// if (history.average < 1000 && history.total > 100) return 100;
		// if (history.average < 10_000 && history.total > 10) return 10;

		if (history.total > 10_000) return 10_000;
		if (history.total > 1000) return 1000;
		if (history.total > 100) return 100;
		if (history.total > 10) return 10;

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
	getPriceData(resourceType: TradeResource): {total: number; average: number; stdDev: number} {
		return cache.inHeap('price:' + resourceType, 5000, () => {
			const history = Game.market.getHistory(resourceType);

			let count = 0;
			let totalValue = 0;
			let totalDev = 0;

			// There needs to be a few days of price data before we consider dealing.
			if (history.length > 3) {
				// Find days with highest and lowest deal values.
				const minDay = _.min(history, 'avgPrice');
				const maxDay = _.max(history, 'avgPrice');
				const maxDev = _.max(history, 'stddevPrice');

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
			}

			const currentOrders = Game.market.getAllOrders(order => order.resourceType === resourceType);
			const {currentCount, currentValue, items} = _.reduce(currentOrders, (result, order: Order) => {
				if (order.resourceType !== resourceType) return result;
				if (order.remainingAmount === 0) return result;

				result.currentCount += order.remainingAmount;
				result.currentValue += order.remainingAmount * order.price;
				result.items.push({ amount: order.remainingAmount, price: order.price });

				return result;
			}, {currentCount: 0, currentValue: 0, items: []});

			const currentStdDev = Math.sqrt(_.reduce(items, (total, item) => {
				return total + Math.pow(item.price - currentValue / currentCount, 2) * item.amount;
			}, 0) / currentCount);

			if (count + currentCount === 0) return null;

			return {
				total: count + currentCount,
				average: (totalValue + currentValue) / (count + currentCount),
				stdDev: (totalDev + currentStdDev) / (count + currentCount),
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
	calculateWorth(resourceType: TradeResource): number {
		return cache.inHeap('resourceWorth:' + resourceType, 5000, () => {
			const history = this.getPriceData(resourceType);
			if (!recipes[resourceType]) {
				return history ? history.average : 0;
			}

			const reagentWorth = _.reduce(recipes[resourceType], (total: number, componentType: ResourceConstant) => {
				const componentWorth = this.calculateWorth(componentType);
				const componentHistory = this.getPriceData(componentType);
				return total + Math.max(componentWorth, componentHistory ? componentHistory.average : 0);
			}, 0);

			// Add 0.1% to price for each tick needed to produce this reagent.
			return reagentWorth * (1 + (0.001 * (REACTION_TIME[resourceType] || 0)));
		});
	}
}
