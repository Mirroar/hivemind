import {getResourcesIn} from 'utils/store';
import TaskProvider from 'dispatcher/task-provider';

interface DropDestinationTask extends ResourceDestinationTask {
	type: 'drop';
}

export default class DropDestination implements TaskProvider<DropDestinationTask, ResourceDestinationContext> {
	constructor(readonly room: Room) {}

	getType(): 'drop' {
		return 'drop';
	}

	getHighestPriority() {
		return 0;
	}

	getTasks(context: ResourceDestinationContext) {
		const options: DropDestinationTask[] = [];

		this.addDropResourceTasks(context, options);

		return options;
	}

	addDropResourceTasks(context: ResourceDestinationContext, options: DropDestinationTask[]) {
		const creep = context.creep;

		for (const resourceType of getResourcesIn(creep.store)) {
			if (resourceType === RESOURCE_ENERGY) continue;

			const storageTarget = creep.room.getBestStorageTarget(creep.store[resourceType], resourceType);
			if (storageTarget) continue;

			// Resources only get dropped if we have nowhere to store them.
			options.push({
				priority: 0,
				weight: 0,
				type: 'drop',
				resourceType: resourceType,
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
		creep.drop(task.resourceType);
		delete creep.memory.order;
	}
}
