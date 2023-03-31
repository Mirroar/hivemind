/* global RESOURCE_ENERGY */

import Process from 'process/process';
import hivemind from 'hivemind';
import utilities from 'utilities';

/**
 * Sends resources between owned rooms when needed.
 */
export default class ResourcesProcess extends Process {
	/**
	 * Transports resources between owned rooms if needed.
	 */
	run() {
		let routes = this.getAvailableTransportRoutes();
		let best = utilities.getBestOption(routes);

		while (best) {
			const room = Game.rooms[best.source];
			const terminal = room.terminal;
			const maxAmount = room.getCurrentResourceAmount(best.resourceType);
			const tradeVolume = Math.ceil(Math.min(maxAmount * 0.9, 5000));
			let sentSuccessfully = true;
			if (tradeVolume === 0) {
				sentSuccessfully = false;
			}
			else if (this.roomHasUncertainStorage(Game.rooms[best.target])) {
				sentSuccessfully = false;
			}
			else if (this.roomNeedsTerminalSpace(room) && terminal.store[best.resourceType] && terminal.store[best.resourceType] > 5000) {
				let amount = Math.min(terminal.store[best.resourceType], 50_000);
				if (best.resourceType === RESOURCE_ENERGY) {
					amount -= Game.market.calcTransactionCost(amount, best.source, best.target);
				}

				const result = terminal.send(best.resourceType, amount, best.target, 'Evacuating');
				hivemind.log('trade').info('evacuating', amount, best.resourceType, 'from', best.source, 'to', best.target, ':', result);
				if (result !== OK) sentSuccessfully = false;
			}
			else if (terminal.store[best.resourceType] && terminal.store[best.resourceType] >= tradeVolume) {
				const result = terminal.send(best.resourceType, tradeVolume, best.target, 'Resource equalizing');
				hivemind.log('trade').info('sending', tradeVolume, best.resourceType, 'from', best.source, 'to', best.target, ':', result);
				if (result !== OK) sentSuccessfully = false;
			}
			else if (this.roomNeedsTerminalSpace(room) && (!room?.storage[best.resourceType] || terminal.store.getFreeCapacity() < terminal.store.getCapacity() * 0.05) && terminal.store[best.resourceType]) {
				const amount = terminal.store[best.resourceType];
				const result = terminal.send(best.resourceType, amount, best.target, 'Evacuating');
				hivemind.log('trade').info('evacuating', amount, best.resourceType, 'from', best.source, 'to', best.target, ':', result);
				if (result !== OK) sentSuccessfully = false;
			}
			else {
				if (!room.memory.fillTerminal) {
					hivemind.log('trade').info('Preparing', tradeVolume, best.resourceType, 'for transport from', best.source, 'to', best.target);
					room.prepareForTrading(best.resourceType);
				}
				sentSuccessfully = false;
			}

			// Use multiple routes as long as no room is involved multiple times.
			if (sentSuccessfully) {
				// Remove any trades involving the rooms sending and receiving.
				routes = _.filter(routes, (option: any) => option.source !== best.source && option.target !== best.source && option.source !== best.target && option.target !== best.target);
			}
			else {
				// Remove any trades for this resource type and source room.
				routes = _.filter(routes, (option: any) => option.source !== best.source || option.resourceType !== best.resourceType);
			}
			best = utilities.getBestOption(routes);
		}
	}

	/**
	 * Determines when it makes sense to transport resources between rooms.
	 *
	 * @return {Array}
	 *   An array of option objects with priorities.
	 */
	getAvailableTransportRoutes() {
		const options = [];
		const rooms = this.getResourceStates();

		_.each(rooms, (roomState: any, roomName: string) => {
			const room = Game.rooms[roomName];
			if (!roomState.canTrade) return;

			// Do not try transferring from a room that is already preparing a transfer.
			if (room.memory.fillTerminal && !this.roomNeedsTerminalSpace(room)) return;

			for (const resourceType of _.keys(roomState.state)) {
				const resourceLevel = roomState.state[resourceType] || 'low';

				this.addResourceRequestOptions(options, room, resourceType, roomState);

				if (!['high', 'excessive'].includes(resourceLevel) && !this.roomNeedsTerminalSpace(room)) continue;

				// Make sure we have enough to send (while evacuating).
				if (this.roomNeedsTerminalSpace(room) && (roomState.totalResources[resourceType] || 0) < 100) continue;
				if (resourceType === RESOURCE_ENERGY && (roomState.totalResources[resourceType] || 0) < 10_000) continue;

				// Look for other rooms that are low on this resource.
				_.each(rooms, (roomState2: any, roomName2: string) => {
					const room2 = Game.rooms[roomName2];
					const resourceLevel2 = roomState2.state[resourceType] || 'low';

					if (!roomState2.canTrade) return;
					if (this.roomNeedsTerminalSpace(room2)) return;

					const isLow = resourceLevel2 === 'low' || (resourceType === RESOURCE_ENERGY && room2.defense.getEnemyStrength() > 0 && resourceLevel2 === 'medium');
					const isLowEnough = resourceLevel2 === 'medium';
					const shouldReceiveResources = isLow || (roomState.state[resourceType] === 'excessive' && isLowEnough);

					if (!this.roomNeedsTerminalSpace(room) && !shouldReceiveResources) return;

					// Make sure target has space left.
					if (room2.terminal.store.getFreeCapacity() < 5000) return;

					// Make sure source room has enough energy to send resources.
					if (room.terminal.store.energy < Game.market.calcTransactionCost(5000, roomName, roomName2)) return;

					const option = {
						priority: 3,
						weight: (((roomState.totalResources[resourceType] || 0) - (roomState2.totalResources[resourceType] || 0)) / 100_000) - Game.map.getRoomLinearDistance(roomName, roomName2),
						resourceType,
						source: roomName,
						target: roomName2,
					};

					if (this.roomNeedsTerminalSpace(room) && resourceType !== RESOURCE_ENERGY) {
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
	}

	addResourceRequestOptions(options: any[], room: Room, resourceType: string, roomState) {
		// Fullfill allies trade requests.
		for (const roomName2 in Memory?.requests?.trade?.[resourceType] || {}) {
			const info = Memory.requests.trade[resourceType][roomName2];
			if (Game.time - info.lastSeen > 10) {
				// Request was not recorded recently, skip it.
				continue;
			}

			const tier = this.getResourceTier(resourceType);
			const shouldReceiveResources =
				roomState.state[resourceType] === 'excessive' && info.priority >= 0.05 ||
				roomState.state[resourceType] === 'high' && (info.priority >= 0.5 || tier > 1) ||
				roomState.state[resourceType] === 'medium' && (info.priority >= 0.8) ||
				roomState.state[resourceType] === 'medium' && (info.priority >= 0.5 && tier > 1) ||
				roomState.state[resourceType] === 'low' && (info.priority >= 0.9) ||
				roomState.state[resourceType] === 'low' && (info.priority >= 0.8 && tier > 1) ||
				roomState.state[resourceType] === 'low' && (info.priority >= 0.5 && tier > 4);
			if (!shouldReceiveResources) continue;

			// Make sure source room has enough energy to send resources.
			const amount = Math.min(roomState.totalResources[resourceType] || 0, 5000);
			if (amount < 100) continue;
			if (room.terminal.store.energy < Game.market.calcTransactionCost(5000, room.name, roomName2)) continue;

			const option = {
				priority: 3,
				weight: (roomState.totalResources[resourceType] / 100_000) - Game.map.getRoomLinearDistance(room.name, roomName2),
				resourceType,
				source: room.name,
				target: roomName2,
			};

			if (this.roomNeedsTerminalSpace(room) && resourceType !== RESOURCE_ENERGY) {
				option.priority++;
				if (room.terminal.store[resourceType] && room.terminal.store[resourceType] >= 5000) {
					option.priority++;
				}
			}
			else if (info.priority < 0.5) {
				option.priority--;
			}

			options.push(option);
		}
	}

	getResourceTier(resourceType: string): number {
		if (resourceType === RESOURCE_ENERGY) return 0;
		if (resourceType === RESOURCE_POWER) return 10;

		const tier = resourceType.length;
		if (resourceType.includes('G')) {
			return tier + 3;
		}

		return tier;
	}

	/**
	 * Collects resource states of all available rooms.
	 *
	 * @return {object}
	 *   Resource states, keyed by room name.
	 */
	getResourceStates() {
		const rooms = {};

		// Collect room resource states.
		for (const room of Game.myRooms) {
			const roomData = room.getResourceState();
			if (!roomData) continue;
			
			rooms[room.name] = roomData;
		}

		return rooms;
	}

	roomNeedsTerminalSpace(room: Room): boolean {
		return room.isEvacuating()
			|| (room.isClearingTerminal() && room.storage && room.storage.store.getFreeCapacity() < room.storage.store.getCapacity() * 0.3)
			|| (room.isClearingStorage() && room.terminal && room.terminal.store.getFreeCapacity() < room.terminal.store.getCapacity() * 0.3);
	}

	roomHasUncertainStorage(room: Room): boolean {
		return room.isEvacuating()
			|| room.isClearingStorage()
			|| room.isClearingTerminal();
	}
}
