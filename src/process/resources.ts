/* global RESOURCE_ENERGY */

import container from 'utils/container';
import hivemind from 'hivemind';
import Process from 'process/process';
import utilities from 'utilities';
import type {TransportRouteOption} from 'empire/trade-route-manager';

/**
 * Sends resources between owned rooms when needed.
 */
export default class ResourcesProcess extends Process {
	/**
	 * Transports resources between owned rooms if needed.
	 */
	run() {
		const manager = container.get('TradeRouteManager');
		let routes: TransportRouteOption[] = manager.getAvailableTransportRoutes();

		this.transportResources(routes);
	}

	transportResources(routes: TransportRouteOption[]) {
		const manager = container.get('TradeRouteManager');
		let best = utilities.getBestOption(routes);
		while (best) {
			const room = Game.rooms[best.source];

			if (room.memory.fillTerminal && room.terminal.store.getFreeCapacity(room.memory.fillTerminal) < 5000) {
				delete room.memory.fillTerminal;
				delete room.memory.fillTerminalAmount;
			}

			const terminal = room.terminal;
			const maxAmount = room.getCurrentResourceAmount(best.resourceType);
			const tradeVolume = Math.ceil(Math.min(maxAmount, 5000));
			let sentSuccessfully = true;
			if (best.source === best.target) {
				sentSuccessfully = false;
			}
			else if (maxAmount === 0) {
				sentSuccessfully = false;
			}
			else if (manager.roomHasUncertainStorage(Game.rooms[best.target])) {
				sentSuccessfully = false;
			}
			else if (manager.roomNeedsTerminalSpace(room) && terminal.store[best.resourceType] && terminal.store[best.resourceType] > 5000) {
				let amount = Math.min(terminal.store[best.resourceType], 50_000);
				if (best.resourceType === RESOURCE_ENERGY) {
					amount -= Game.market.calcTransactionCost(amount, best.source, best.target);
				}
				else {
					const energyCost = Game.market.calcTransactionCost(amount, best.source, best.target);
					const availableEnergy = terminal.store.getUsedCapacity(RESOURCE_ENERGY);
					if (energyCost > availableEnergy) {
						amount = Math.floor(amount * availableEnergy / energyCost);
					}
				}

				const result = terminal.send(best.resourceType, amount, best.target, 'Evacuating');
				hivemind.log('trade').info('evacuating', amount, best.resourceType, 'from', best.source, 'to', best.target, ':', result);
				if (result !== OK) sentSuccessfully = false;
			}
			else if (terminal.store[best.resourceType] && terminal.store[best.resourceType] >= tradeVolume * 0.9) {
				const amount = Math.min(tradeVolume, terminal.store[best.resourceType]);
				const result = terminal.send(best.resourceType, amount, best.target, 'Resource equalizing');
				hivemind.log('trade').info('sending', amount, best.resourceType, 'from', best.source, 'to', best.target, ':', result);
				if (result !== OK) sentSuccessfully = false;
			}
			else if (manager.roomNeedsTerminalSpace(room) && (!room?.storage[best.resourceType] || terminal.store.getFreeCapacity() < terminal.store.getCapacity() * 0.05) && terminal.store[best.resourceType]) {
				const amount = terminal.store[best.resourceType];
				const result = terminal.send(best.resourceType, amount, best.target, 'Evacuating');
				hivemind.log('trade').info('evacuating', amount, best.resourceType, 'from', best.source, 'to', best.target, ':', result);
				if (result !== OK) sentSuccessfully = false;
			}
			else {
				if (
					!room.memory.fillTerminal
					&& (room.terminal.store.getFreeCapacity(best.resourceType) - room.terminal.store.getUsedCapacity(best.resourceType)) > tradeVolume
				) {
					hivemind.log('trade').info('Preparing', tradeVolume, best.resourceType, 'for transport from', best.source, 'to', best.target);
					room.prepareForTrading(best.resourceType);
				}

				sentSuccessfully = false;
			}

			// Use multiple routes as long as no room is involved multiple times.
			routes = sentSuccessfully ? _.filter(routes, (option: any) => option.source !== best.source && option.target !== best.source && option.source !== best.target && option.target !== best.target) : _.filter(routes, (option: any) => option.source !== best.source || option.resourceType !== best.resourceType);
			best = utilities.getBestOption(routes);
		}
	}
}
