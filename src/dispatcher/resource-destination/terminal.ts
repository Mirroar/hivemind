import StructureDestination from 'dispatcher/resource-destination/structure';

interface TerminalDestinationTask extends StructureDestinationTask {
	type: 'terminal';
	target: Id<StructureTerminal>;
}

export default class TerminalDestination extends StructureDestination<TerminalDestinationTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'terminal' {
		return 'terminal';
	}

	getHighestPriority() {
		return 4;
	}

	getTasks(context: ResourceDestinationContext) {
		if (!this.room.terminal) return [];
		if (this.room.isClearingTerminal()) return [];

		return this.cacheEmptyTaskListFor(context.resourceType || '', 25, () => {
			const options: TerminalDestinationTask[] = [];

			this.addMinimumEnergyDestination(options, context);
			this.addTransferResourceDestination(options, context);
			this.addResourcesForSaleDestination(options, context);

			return options;
		});
	}

	addMinimumEnergyDestination(options: TerminalDestinationTask[], context: ResourceDestinationContext) {
		if (context.resourceType && context.resourceType !== RESOURCE_ENERGY) return;
		if (this.terminalNeedsClearing()) return;

		const terminal = this.room.terminal;
		if (terminal.store[RESOURCE_ENERGY] >= 5_000) return;

		if (!this.room.storage) return;

		options.push({
			priority: 3,
			weight: 1 - (terminal.store[RESOURCE_ENERGY] / 5_000),
			type: this.getType(),
			target: terminal.id,
			resourceType: RESOURCE_ENERGY,
			amount: 5_000 - terminal.store[RESOURCE_ENERGY],
		});
	}

	terminalNeedsClearing() {
		const terminal = this.room.terminal;
		return terminal
			&& this.room.isClearingTerminal()
			&& !this.room.isClearingStorage();
	}

	addTransferResourceDestination(options: TerminalDestinationTask[], context: ResourceDestinationContext) {
		if (!this.room.memory.fillTerminal) return;

		const resourceType = this.room.memory.fillTerminal;
		if (context.resourceType && resourceType !== context.resourceType) return;

		const terminal = this.room.terminal;
		if (terminal.store.getUsedCapacity(RESOURCE_ENERGY) <= 5000) return;

		const targetAmount = this.room.memory.fillTerminalAmount || 10_000;
		const missingAmount = targetAmount - terminal.store.getUsedCapacity(resourceType);

		if (missingAmount <= 0) {
			// @todo This call shouldn't be within the dispatcher system.
			// Move it to a more appropriate place.
			this.room.stopTradePreparation();
			return;
		}

		if (terminal.store.getFreeCapacity(resourceType) <= missingAmount) return;

		// Make sure we have somewhere to take enough resources from.
		if (this.room.getCurrentResourceAmount(resourceType) < targetAmount) {
			this.room.stopTradePreparation();
			return;
		}

		options.push({
			priority: 4,
			weight: missingAmount / targetAmount,
			type: this.getType(),
			target: terminal.id,
			resourceType,
			amount: missingAmount,
		});
	}

	addResourcesForSaleDestination(options: TerminalDestinationTask[], context: ResourceDestinationContext) {
		const terminal = this.room.terminal;

		// @todo Instead of filtering all orders, have a list of my own orders.
		// That way we can avoid filtering all orders multiple times.
		const roomSellOrders = _.filter(Game.market.orders, (order: Order) => order.roomName === this.room.name && order.type === ORDER_SELL);
		for (const order of roomSellOrders) {
			if (order.remainingAmount <= 0) continue;
			const resourceType = order.resourceType as ResourceConstant;
			if (context.resourceType && resourceType !== context.resourceType) continue;
			if (terminal.store[resourceType] >= order.remainingAmount) continue;
			if (this.room.getCurrentResourceAmount(resourceType) < order.remainingAmount) continue;
			if (terminal.store.getFreeCapacity(resourceType) < order.remainingAmount - terminal.store[resourceType]) continue;

			options.push({
				priority: 4,
				weight: order.remainingAmount - terminal.store[resourceType] / order.remainingAmount,
				type: this.getType(),
				target: terminal.id,
				resourceType: resourceType as ResourceConstant,
				amount: order.remainingAmount - terminal.store[resourceType],
			});
		}
	}

	isValid(task: TerminalDestinationTask, context: ResourceDestinationContext) {
		if (!super.isValid(task, context)) return false;
		if (this.room.isClearingTerminal()) return false;

		return true;
	}
}
