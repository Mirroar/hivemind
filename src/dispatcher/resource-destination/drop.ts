import {getResourcesIn} from 'utils/store';
import TaskProvider from 'dispatcher/task-provider';

interface DropDestinationTask extends ResourceDestinationTask {
	type: 'drop';
}

export default class DropDestination extends TaskProvider<DropDestinationTask, ResourceDestinationContext> {
	constructor(readonly room: Room) {
		super();
	}

	getType(): 'drop' {
		return 'drop';
	}

	getHighestPriority() {
		return 0;
	}

	getTasks(context: ResourceDestinationContext) {
		return this.cacheEmptyTaskListFor(context.resourceType || '', 100, () => {
			const options: DropDestinationTask[] = [];

			this.addDropResourceTasks(context, options);

			return options;
		});
	}

	addDropResourceTasks(context: ResourceDestinationContext, options: DropDestinationTask[]) {
		const creep = context.creep;

		const terminal = this.room.terminal;
		const terminalNeedsSpaceForEnergy = terminal && (terminal.store.getFreeCapacity() + terminal.store.getUsedCapacity(RESOURCE_ENERGY)) < 5000;
		for (const resourceType of getResourcesIn(creep.store)) {
			const storageTarget = creep.room.getBestStorageTarget(creep.store[resourceType], resourceType);
			const wouldBlockTerminal = storageTarget === terminal
				&& terminalNeedsSpaceForEnergy
				&& resourceType !== RESOURCE_ENERGY;
			if (storageTarget && !wouldBlockTerminal) continue;

			// Resources only get dropped if we have nowhere to store them.
			options.push({
				priority: 0,
				weight: 0,
				type: 'drop',
				resourceType,
				amount: creep.store[resourceType],
			});
		}
	}

	isValid(task: DropDestinationTask, context: ResourceDestinationContext) {
		if (!context.creep.store[task.resourceType]) return false;

		return true;
	}

	execute(task: DropDestinationTask, context: ResourceDestinationContext) {
		const creep = context.creep;

		if (task.resourceType === RESOURCE_ENERGY && creep.pos.getRangeTo(creep.room.getStorageLocation()) > 0) {
			creep.whenInRange(0, creep.room.getStorageLocation(), () => {
				if (creep.drop(task.resourceType) === OK) {
					delete creep.memory.order;
				}
			});

			return;
		}

		if (creep.drop(task.resourceType) === OK) {
			delete creep.memory.order;
		}
	}
}
