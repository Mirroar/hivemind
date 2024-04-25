import StructureSource from 'dispatcher/resource-source/structure';
import {getResourcesIn} from 'utils/store';

interface TerminalSourceTask extends StructureSourceTask {
	type: 'terminal';
	target: Id<StructureStorage | StructureTerminal>;
}

export default class TerminalSource extends StructureSource<TerminalSourceTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'terminal' {
		return 'terminal';
	}

	getHighestPriority(context?: ResourceSourceContext) {
		return 2;
	}

	getTasks(context: ResourceSourceContext) {
		if (!this.room.terminal) return [];

		return this.cacheEmptyTaskListFor(context.resourceType || '', 25, () => {
			const options: TerminalSourceTask[] = [];

			this.addTerminalOperationResourceOptions(options, context);

			return options;
		});
	}

	addTerminalOperationResourceOptions(options: TerminalSourceTask[], context: ResourceSourceContext) {
		const storage = this.room.storage;
		const terminal = this.room.terminal;
		if (!storage || !terminal) return;

		// Take resources from storage to terminal for transfer if requested.
		if (this.room.memory.fillTerminal && terminal.store[RESOURCE_ENERGY] > 5000) {
			const resourceType = this.room.memory.fillTerminal;
			if (context.resourceType && resourceType !== context.resourceType) return;
			if (storage.store[resourceType]) {
				if (terminal.store.getFreeCapacity() > 10_000) {
					options.push({
						priority: 4,
						weight: 0,
						type: 'terminal',
						target: storage.id,
						resourceType,
					});
				}
			}
			else {
				// No more of these resources can be taken into terminal.
				delete this.room.memory.fillTerminal;
			}
		}

		if (this.room.isClearingTerminal()) return;

		const roomSellOrders = _.filter(Game.market.orders, order => order.roomName === this.room.name && order.type === ORDER_SELL);
		_.each(roomSellOrders, order => {
			if (context.resourceType && order.resourceType !== context.resourceType) return;
			if ((terminal.store[order.resourceType] || 0) >= order.remainingAmount) return;
			if (!storage.store[order.resourceType]) return;
			if (terminal.store.getFreeCapacity() < order.remainingAmount - (terminal.store[order.resourceType] || 0)) return;

			options.push({
				priority: 4,
				weight: 0,
				type: 'terminal',
				target: storage.id,
				resourceType: order.resourceType as ResourceConstant,
			});
		});
	}
}
