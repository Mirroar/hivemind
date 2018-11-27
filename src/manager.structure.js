// @todo Build containers automatically at calculated dropoff spots.

var utilities = require('utilities');

StructureKeeperLair.prototype.isDangerous = function () {
    return !this.ticksToSpawn || this.ticksToSpawn < 20;
};

Room.prototype.manageLabs = function () {
    if (!this.controller || !this.controller.my || Game.cpu.bucket < 5000 || !this.memory.canPerformReactions || !this.memory.currentReaction) return;

    var source1 = Game.getObjectById(this.memory.labs.source1);
    var source2 = Game.getObjectById(this.memory.labs.source2);
    if (!source1 || !source2) return;

    if (this.visual) {
        this.visual.circle(source1.pos, {fill: '#4080ff'});
        this.visual.circle(source2.pos, {fill: '#4080ff'});
    }

    var labs = this.memory.labs.reactor;
    if (!labs) return;
    if (typeof labs == 'string') {
        labs = [labs];
        this.memory.labs.reactor = labs;
    }
    for (let i in labs) {
        var reactor = Game.getObjectById(labs[i]);

        if (source1 && source2 && reactor) {
            if (reactor.cooldown <= 0 && source1.mineralType == this.memory.currentReaction[0] && source2.mineralType == this.memory.currentReaction[1]) {
                reactor.runReaction(source1, source2);
            }
        }
    }
};

Room.prototype.prepareForTrading = function (resourceType, amount) {
    if (!amount) amount = 10000;
    this.memory.fillTerminal = resourceType;
    this.memory.fillTerminalAmount = Math.min(amount, 50000);
};

Room.prototype.stopTradePreparation = function () {
    delete this.memory.fillTerminal;
    delete this.memory.fillTerminalAmount;
};

/**
 * Starts evacuation process for a room to prepare it for being abandoned.
 */
Room.prototype.setEvacuating = function (evacuate) {
    this.memory.isEvacuating = evacuate;
};

/**
 * Checks if a room is currently evacuating.
 */
Room.prototype.isEvacuating = function () {
    return this.memory.isEvacuating;
};

/**
 * Starts emptying a rooms terminal and keeps it empty.
 */
Room.prototype.setClearingTerminal = function (clear) {
    this.memory.isClearingTerminal = clear;
};

/**
 * Checks if a room's terminal should be emptied.
 */
Room.prototype.isClearingTerminal = function () {
    return this.memory.isClearingTerminal;
};

var structureManager = {

    getResourceTier: function (resourceType) {
        let tier;
        if (resourceType == RESOURCE_ENERGY) {
            tier = 0;
        }
        else if (resourceType == RESOURCE_POWER) {
            tier = 10;
        }
        else {
            tier = resourceType.length;
            if (resourceType.indexOf('G') != -1) {
                tier += 3;
            }
        }

        return tier;
    },

    reportResources: function () {
        var resources = structureManager.getRoomResourceStates();
        var total = resources.total;
        var output = '';

        for (let i in RESOURCES_ALL) {
            let resourceType = RESOURCES_ALL[i];
            let tier = structureManager.getResourceTier(resourceType);

            output += '\n';
            output += 'Tier ' + ('  ' + tier).slice(-2);
            output += ' [' + ('      ' + resourceType).slice(-6) + ']';

            if (resourceType.length == 1 && resourceType != 'G') {
                output += ('    ' + (total.sources[resourceType] || 0) + ' source' + (total.sources[resourceType] == 1 ? ' ' : 's')).slice(-11);
            }
            else {
                output += '           ';
            }

            output += ('          ' + (total.resources[resourceType] || 0)).slice(-10);
        }

        console.log(output);
    },

    findBestBuyOrder: function (resourceType, roomName) {
        // Find best deal for selling this resource.
        let orders = Game.market.getAllOrders((order) => order.type == ORDER_BUY && order.resourceType == resourceType);

        let maxScore;
        let bestOrder;
        for (let i in orders) {
            let order = orders[i];
            if (order.amount < 100) continue;
            let transactionCost = Game.market.calcTransactionCost(1000, roomName, order.roomName);
            let credits = 1000 * order.price;
            let score = credits - 0.3 * transactionCost;

            if (!maxScore || score > maxScore) {
                maxScore = score;
                bestOrder = order;
            }
        }

        return bestOrder;
    },

    findBestSellOrder: function (resourceType, roomName) {
        // Find best deal for buying this resource.
        let orders = Game.market.getAllOrders((order) => order.type == ORDER_SELL && order.resourceType == resourceType);

        let minScore;
        let bestOrder;
        for (let i in orders) {
            let order = orders[i];
            if (order.amount < 100) continue;
            let transactionCost = Game.market.calcTransactionCost(1000, roomName, order.roomName);
            let credits = 1000 * order.price;
            let score = credits + 0.3 * transactionCost;

            if (!minScore || score < minScore) {
                minScore = score;
                bestOrder = order;
            }
        }

        return bestOrder;
    },

    instaSellResources: function (resourceType, rooms) {
        //hivemind.log('trade').debug('Trying to instantly sell some', resourceType);

        // Find room with highest amount of this resource.
        let bestRoom;
        let maxAmount;
        for (let roomName in rooms) {
            let roomState = rooms[roomName];
            if (!roomState.canTrade) continue;
            if (!maxAmount || (roomState.totalResources[resourceType] || 0) > maxAmount) {
                maxAmount = roomState.totalResources[resourceType];
                bestRoom = roomName;
            }
        }
        if (!bestRoom) return;
        let room = Game.rooms[bestRoom];

        let bestOrder = structureManager.findBestBuyOrder(resourceType, bestRoom);

        if (!bestOrder) return;

        let amount = Math.min(5000, bestOrder.amount);
        let transactionCost = Game.market.calcTransactionCost(amount, bestRoom, bestOrder.roomName);

        if (amount > (room.terminal.store[resourceType] || 0)) {
            if (!room.memory.fillTerminal) {
                room.prepareForTrading(resourceType, amount);
                hivemind.log('trade', bestRoom).info('Preparing', amount, resourceType, 'for selling to', bestOrder.roomName, 'at', bestOrder.price, 'credits each, costing', transactionCost, 'energy');
            }
            else {
                hivemind.log('trade', bestRoom).info('Busy, can\'t prepare', amount, resourceType, 'for selling.');
            }
            return;
        }

        if (transactionCost > room.terminal.store.energy) {
            if (!room.memory.fillTerminal) {
                room.prepareForTrading(RESOURCE_ENERGY, transactionCost);
                hivemind.log('trade', bestRoom).info('Preparing', transactionCost, 'energy for selling', amount, resourceType, 'to', bestOrder.roomName, 'at', bestOrder.price, 'credits each');
            }
            else {
                hivemind.log('trade', bestRoom).info('Busy, can\'t prepare', transactionCost, 'energy for selling', amount, resourceType);
            }
            return;
        }

        hivemind.log('trade', bestRoom).info('Selling', amount, resourceType, 'to', bestOrder.roomName, 'for', bestOrder.price, 'credits each, costing', transactionCost, 'energy');

        if (Game.market.deal(bestOrder.id, amount, bestRoom) == OK) {
            return true;
        }
    },

    instaBuyResources: function (resourceType, rooms) {
        //hivemind.log('trade').debug('Trying to instantly buy some', resourceType);

        // Find room with lowest amount of this resource.
        let bestRoom;
        let minAmount;
        for (let roomName in rooms) {
            let roomState = rooms[roomName];
            if (!roomState.canTrade) continue;
            if (Game.rooms[roomName] && Game.rooms[roomName].isFullOn(resourceType)) continue;
            if (!minAmount || (roomState.totalResources[resourceType] || 0) < minAmount) {
                minAmount = roomState.totalResources[resourceType];
                bestRoom = roomName;
            }
        }
        if (!bestRoom) return;
        let room = Game.rooms[bestRoom];

        let bestOrder = structureManager.findBestSellOrder(resourceType, bestRoom);

        if (!bestOrder) return;

        let amount = Math.min(5000, bestOrder.amount);
        let transactionCost = Game.market.calcTransactionCost(amount, bestRoom, bestOrder.roomName);

        if (transactionCost > room.terminal.store.energy) {
            if (!room.memory.fillTerminal) {
                room.prepareForTrading(RESOURCE_ENERGY, transactionCost);
                hivemind.log('trade', bestRoom).info('Preparing', transactionCost, 'energy for buying', amount, resourceType, 'from', bestOrder.roomName, 'at', bestOrder.price, 'credits each');
            }
            else {
                hivemind.log('trade', bestRoom).info('Busy, can\'t prepare', transactionCost, 'energy for buying', amount, resourceType);
            }
            return;
        }

        hivemind.log('trade', bestRoom).info('Buying', amount, resourceType, 'from', bestOrder.roomName, 'for', bestOrder.price, 'credits each, costing', transactionCost, 'energy');

        if (Game.market.deal(bestOrder.id, amount, bestRoom) == OK) {
            return true;
        }
    },

    tryBuyResources: function (resourceType, rooms, ignoreOtherRooms) {
        //hivemind.log('trade').debug('Trying to cheaply buy some', resourceType);

        let npcPrice = 1;
        if (resourceType == RESOURCE_ENERGY) {
            npcPrice = 0.1;
        }

        if (_.filter(Game.market.orders, (order) => {
            if (order.type == ORDER_BUY && order.resourceType == resourceType) {
                if (ignoreOtherRooms && !rooms[order.roomName]) {
                    return false;
                }
                return true;
            }
        }).length > 0) {
            //hivemind.log('trade').debug('Already buying', resourceType);
            return;
        }

        // Find room with lowest amount of this resource.
        let bestRoom;
        let minAmount;
        for (let roomName in rooms) {
            let roomState = rooms[roomName];
            if (!roomState.canTrade) continue;
            if (Game.rooms[roomName] && Game.rooms[roomName].isFullOn(resourceType)) continue;
            if (!minAmount || (roomState.totalResources[resourceType] || 0) < minAmount) {
                minAmount = roomState.totalResources[resourceType];
                bestRoom = roomName;
            }
        }
        if (!bestRoom) return;
        let room = Game.rooms[bestRoom];

        // Find comparable deals for buying this resource.
        let bestBuyOrder = structureManager.findBestBuyOrder(resourceType, bestRoom);
        let bestSellOrder = structureManager.findBestSellOrder(resourceType, bestRoom);

        let offerPrice;
        if (bestBuyOrder && bestSellOrder) {
            hivemind.log('trade', bestRoom).info(resourceType, 'is currently being bought for', bestBuyOrder.price, 'and sold for', bestSellOrder.price, 'credits.');
            offerPrice = Math.min(bestBuyOrder.price * 0.9, bestSellOrder.price * 0.9);
        }
        else if (bestBuyOrder) {
            // Nobody is selling this resource, so adapt to the current buy price.
            hivemind.log('trade', bestRoom).info(resourceType, 'is currently being bought for', bestBuyOrder.price);
            offerPrice = bestBuyOrder.price * 0.9;
        }
        else {
            // Nobody is buying this resource, try to get NPC price for it.
            hivemind.log('trade', bestRoom).info('Nobody else is currently buying', resourceType);
            offerPrice = npcPrice;
        }

        // Pay no less than 1.05 and no more than 3 credits.
        // offerPrice = Math.max(offerPrice, npcPrice * 1.05);
        // offerPrice = Math.min(offerPrice, npcPrice * 3);

        hivemind.log('trade', bestRoom).debug('Offering to buy for', offerPrice);

        // Make sure we have enough credits to actually buy this.
        if (Game.market.credits < 10000 * offerPrice) {
            //hivemind.log('trade', bestRoom).debug('Not enough credits, no buy order created.');
            return;
        }

        Game.market.createOrder(ORDER_BUY, resourceType, offerPrice, 10000, bestRoom);
    },

    trySellResources: function (resourceType, rooms) {
        //hivemind.log('trade').debug('Trying to profitably sell some', resourceType);

        let npcPrice = 1;

        if (_.filter(Game.market.orders, (order) => order.type == ORDER_SELL && order.resourceType == resourceType).length > 0) {
            //hivemind.log('trade').debug('Already selling', resourceType);
            return;
        }

        // Find room with highest amount of this resource.
        let bestRoom;
        let maxAmount;
        for (let roomName in rooms) {
            let roomState = rooms[roomName];
            if (!roomState.canTrade) continue;
            if (!maxAmount || (roomState.totalResources[resourceType] || 0) > maxAmount) {
                maxAmount = roomState.totalResources[resourceType];
                bestRoom = roomName;
            }
        }
        if (!bestRoom) return;
        let room = Game.rooms[bestRoom];

        // Find comparable deals for selling this resource.
        let bestBuyOrder = structureManager.findBestBuyOrder(resourceType, bestRoom);
        let bestSellOrder = structureManager.findBestSellOrder(resourceType, bestRoom);

        let offerPrice;
        if (bestBuyOrder && bestSellOrder) {
            hivemind.log('trade', bestRoom).info(resourceType, 'is currently being bought for', bestBuyOrder.price, 'and sold for', bestSellOrder.price, 'credits.');
            offerPrice = Math.max(bestBuyOrder.price / 0.9, bestSellOrder.price / 0.9);
        }
        else if (bestSellOrder) {
            // Nobody is buying this resource, so adapt to the current sell price.
            hivemind.log('trade', bestRoom).info(resourceType, 'is currently being sold for', bestSellOrder.price);
            offerPrice = bestSellOrder.price / 0.9;
        }
        else {
            // Nobody is selling this resource, try to get a greedy price for it.
            hivemind.log('trade', bestRoom).info('Nobody else is currently selling', resourceType);
            offerPrice = npcPrice * 5;
        }

        // Demand no less than 1.2 and no more than 5 credits.
        // offerPrice = Math.max(offerPrice, npcPrice * 1.2);
        // offerPrice = Math.min(offerPrice, npcPrice * 5);

        hivemind.log('trade', bestRoom).debug('Offering to sell for', offerPrice);

        // Make sure we have enough credits to actually sell this.
        if (Game.market.credits < 10000 * offerPrice * 0.05) {
            //hivemind.log('trade', bestRoom).debug('Not enough credits, no sell order created.');
            return;
        }

        Game.market.createOrder(ORDER_SELL, resourceType, offerPrice, 10000, bestRoom);
    },

    removeOldTrades: function () {
        for (let id in Game.market.orders) {
            let order = Game.market.orders[id];
            let age = Game.time - order.created;

            if (age > 100000 || order.remainingAmount < 100) {
                // Nobody seems to be buying or selling this order, cancel it.
                hivemind.log('trade', order.roomName).debug('Cancelling old trade', order.type + 'ing', order.remainingAmount, order.resourceType, 'for', order.price, 'each after', age, 'ticks.');
                Game.market.cancelOrder(order.id);
            }
        }
    },

    manageTrade: function () {
        structureManager.removeOldTrades();

        var resources = structureManager.getRoomResourceStates();
        var total = resources.total;

        for (let i in RESOURCES_ALL) {
            let resourceType = RESOURCES_ALL[i];
            let tier = structureManager.getResourceTier(resourceType);

            if (tier == 1) {
                let maxStorage = total.rooms * 50000;
                let highStorage = total.rooms * 20000;
                let lowStorage = total.rooms * 10000;
                let minStorage = total.rooms * 5000;

                // Check for base resources we have too much of.
                if ((total.resources[resourceType] || 0) > maxStorage) {
                    structureManager.instaSellResources(resourceType, resources.rooms);
                }
                else if ((total.resources[resourceType] || 0) > highStorage) {
                    structureManager.trySellResources(resourceType, resources.rooms);
                }
                else if ((total.resources[resourceType] || 0) < lowStorage && Game.market.credits > 1000) {
                    // @todo Actually iterate over all tier 1 resources to make sure we buy every type.
                    structureManager.tryBuyResources(resourceType, resources.rooms);
                }
                else if ((total.resources[resourceType] || 0) < minStorage && Game.market.credits > 10000) {
                    // @todo Actually iterate over all tier 1 resources to make sure we buy every type.
                    structureManager.instaBuyResources(resourceType, resources.rooms);
                }
            }
        }

        if (Game.market.credits > 5000) {
            // Also try to cheaply buy some energy for rooms that are low on it.
            let lowRooms = {};
            for (let roomName in resources.rooms) {
                let roomState = resources.rooms[roomName];

                if (!roomState.canTrade) continue;
                if (roomState.isEvacuating) continue;

                if ((roomState.totalResources[RESOURCE_ENERGY] || 0) < 100000) {
                    lowRooms[roomName] = roomState;
                }
            }

            for (let roomName in lowRooms) {
                // @todo Force creating a buy order for every affected room.
                let temp = {};
                temp[roomName] = lowRooms[roomName];
                structureManager.tryBuyResources(RESOURCE_ENERGY, temp, true);
            }
        }
    },

    /**
     * Determines the amount of available resources in each room.
     */
    getRoomResourceStates: function () {
        var rooms = {};
        var total = {
            resources: {},
            sources: {},
            rooms: 0,
        };

        for (let roomId in Game.rooms) {
            let room = Game.rooms[roomId];

            let storage = room.storage;
            let terminal = room.terminal;

            if (!room.controller || !room.controller.my) {
                continue;
            }

            total.rooms++;

            let roomData = {
                totalResources: {},
                state: {},
                canTrade: false,
            };
            if (storage && terminal) {
                roomData.canTrade = true;
            }

            roomData.isEvacuating = room.isEvacuating();

            if (storage && !roomData.isEvacuating) {
                for (let resourceType in storage.store) {
                    roomData.totalResources[resourceType] = storage.store[resourceType];
                    total.resources[resourceType] = (total.resources[resourceType] || 0) + storage.store[resourceType];
                }
            }
            if (terminal) {
                for (let resourceType in terminal.store) {
                    if (!roomData.totalResources[resourceType]) {
                        roomData.totalResources[resourceType] = 0;
                    }
                    roomData.totalResources[resourceType] += terminal.store[resourceType];
                    total.resources[resourceType] = (total.resources[resourceType] || 0) + terminal.store[resourceType];
                }
            }

            if (room.mineral && !roomData.isEvacuating) {
                // @todo Only count if there is an extractor on this mineral.
                roomData.mineralType = room.mineral.mineralType;
                total.sources[room.mineral.mineralType] = (total.sources[room.mineral.mineralType] || 0) + 1;
            }

            // Add resources in labs as well.
            if (room.memory.labs && !roomData.isEvacuating) {
                let ids = [];
                if (room.memory.labs.source1) {
                    ids.push(room.memory.labs.source1);
                }
                if (room.memory.labs.source2) {
                    ids.push(room.memory.labs.source2);
                }
                if (room.memory.labs.reactor) {
                    for (let i in room.memory.labs.reactor) {
                        ids.push(room.memory.labs.reactor[i]);
                    }
                }

                for (let i in ids) {
                    let lab = Game.getObjectById(ids[i]);
                    if (lab && lab.mineralType && lab.mineralAmount > 0) {
                        roomData.totalResources[lab.mineralType] = (roomData.totalResources[lab.mineralType] || 0) + lab.mineralAmount;
                        total.resources[lab.mineralType] = (total.resources[lab.mineralType] || 0) + lab.mineralAmount;
                    }
                }
            }

            for (let resourceType in roomData.totalResources) {
                let amount = roomData.totalResources[resourceType];
                if (resourceType == RESOURCE_ENERGY) {
                    amount /= 2.5;
                }

                if (amount >= 220000) {
                    roomData.state[resourceType] = 'excessive';
                }
                else if (amount >= 30000) {
                    roomData.state[resourceType] = 'high';
                }
                else if (amount >= 10000) {
                    roomData.state[resourceType] = 'medium';
                }
                else {
                    roomData.state[resourceType] = 'low';
                }
            }

            rooms[room.name] = roomData;
        }

        return {
            rooms: rooms,
            total: total,
        };
    },

    /**
     * Determines when it makes sense to transport resources between rooms.
     */
    getAvailableTransportRoutes: function (rooms) {
        var options = [];

        for (var roomName in rooms) {
            var roomState = rooms[roomName];
            if (!roomState.canTrade) continue;

            // Do not try transferring from a room that is already preparing a transfer.
            if (Game.rooms[roomName].memory.fillTerminal && !roomState.isEvacuating) continue;

            for (var resourceType in roomState.state) {
                if (roomState.state[resourceType] == 'high' || roomState.state[resourceType] == 'excessive' || roomState.isEvacuating) {
                    // Make sure we have enough to send (while evacuating).
                    if (roomState.totalResources[resourceType] < 100) continue;
                    if (resourceType == RESOURCE_ENERGY && roomState.totalResources[resourceType] < 10000) continue;

                    // Look for other rooms that are low on this resource.
                    for (var roomName2 in rooms) {
                        if (!rooms[roomName2].canTrade) continue;
                        if (rooms[roomName2].isEvacuating) continue;

                        if (roomState.isEvacuating || !rooms[roomName2].state[resourceType] || rooms[roomName2].state[resourceType] == 'low' || (roomState.state[resourceType] == 'excessive' && (rooms[roomName2].state[resourceType] == 'medium' || rooms[roomName2].state[resourceType] == 'high'))) {

                            // Make sure target has space left.
                            if (_.sum(Game.rooms[roomName2].terminal.store) > Game.rooms[roomName2].terminal.storeCapacity - 5000) {
                                continue;
                            }

                            var option = {
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
    },

    /**
     * Sets appropriate reactions for each room depending on available resources.
     */
    chooseReactions: function (rooms) {
        for (let roomName in rooms) {
            let room = Game.rooms[roomName];
            let roomData = rooms[roomName];

            if (room && room.isEvacuating()) {
                room.memory.bestReaction = null;
                continue;
            }

            if (room && room.memory.canPerformReactions) {
                // Try to find possible reactions where we have a good amount of resources.
                var bestReaction = null;
                var mostResources = null;
                for (var resourceType in roomData.totalResources) {
                    if (roomData.totalResources[resourceType] > 0 && REACTIONS[resourceType]) {
                        for (var resourceType2 in REACTIONS[resourceType]) {
                            let targetType = REACTIONS[resourceType][resourceType2];
                            if (roomData.totalResources[targetType] > 10000) continue;

                            if (roomData.totalResources[resourceType2] && roomData.totalResources[resourceType2] > 0) {
                                //console.log(resourceType, '+', resourceType2, '=', REACTIONS[resourceType][resourceType2]);
                                var resourceAmount = Math.min(roomData.totalResources[resourceType], roomData.totalResources[resourceType2]);

                                // Also prioritize reactions whose product we don't have much of.
                                resourceAmount -= (roomData.totalResources[targetType] || 0);

                                if (!mostResources || mostResources < resourceAmount) {
                                    mostResources = resourceAmount;
                                    bestReaction = [resourceType, resourceType2];
                                }
                            }
                        }
                    }
                }

                room.memory.currentReaction = bestReaction;
                if (bestReaction) {
                    hivemind.log('labs', roomName).info('now producing', REACTIONS[bestReaction[0]][bestReaction[1]]);
                }
            }
        }
    },

    /**
     * Manages all rooms' resources.
     */
    manageResources: function () {
        let rooms = structureManager.getRoomResourceStates();
        let routes = structureManager.getAvailableTransportRoutes(rooms.rooms);
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
        else {
            //hivemind.log('trade').info("Nothing to trade");
        }

        if (Game.time % 1500 == 981) {
            structureManager.chooseReactions(rooms.rooms);
        }
    },

};

module.exports = structureManager;
