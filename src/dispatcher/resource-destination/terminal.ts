import StructureDestination from 'dispatcher/resource-destination/structure';
import TaskProvider from 'dispatcher/task-provider';

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

		const options: TerminalDestinationTask[] = [];

		this.addTransferResourceDestination(options, context);
		this.addResourcesForSaleDestination(options, context);

		return options;
	}

	addTransferResourceDestination(options: TerminalDestinationTask[], context: ResourceDestinationContext) {
		if (!this.room.memory.fillTerminal) return;

		const resourceType = this.room.memory.fillTerminal;
		if (context.resourceType && resourceType !== context.resourceType) return;

		const terminal = this.room.terminal;

		const fillAmount = this.room.memory.fillTerminalAmount || 10_000;
		if (terminal.store[resourceType] >= fillAmount) {
			this.room.stopTradePreparation();
			return;
		}

		options.push({
			priority: 4,
			weight: (fillAmount - terminal.store[resourceType]) / 100,
			type: this.getType(),
			target: terminal.id,
			resourceType,
			amount: fillAmount - terminal.store[resourceType],
		});
	}

	addResourcesForSaleDestination(options: TerminalDestinationTask[], context: ResourceDestinationContext) {
		const terminal = this.room.terminal;

		const roomSellOrders = _.filter(Game.market.orders, order => order.roomName === this.room.name && order.type === ORDER_SELL);
		for (const order of roomSellOrders) {
			if (context.resourceType && order.resourceType !== context.resourceType) continue;
			if (terminal.store[order.resourceType] >= order.remainingAmount) continue;

			options.push({
				priority: 4,
				weight: order.remainingAmount - terminal.store[order.resourceType] / 100,
				type: this.getType(),
				target: terminal.id,
				resourceType: order.resourceType as ResourceConstant,
				amount: order.remainingAmount - terminal.store[order.resourceType],
			});
		}
	}

	isValid(task: TerminalDestinationTask, context: ResourceDestinationContext) {
		if (!super.isValid(task, context)) return false;
		if (this.room.isClearingTerminal()) return false;

		return true;
	}
}
