import StructureDestination from 'dispatcher/resource-destination/structure';
import TaskProvider from 'dispatcher/task-provider';

interface FactoryDestinationTask extends StructureDestinationTask {
	type: 'factory';
	target: Id<StructureFactory>;
}

export default class FactoryDestination extends StructureDestination<FactoryDestinationTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'factory' {
		return 'factory';
	}

	getHighestPriority() {
		return 3;
	}

	getTasks(context: ResourceDestinationContext) {
		if (!this.room.factory) return [];
		if (this.room.factory.store.getFreeCapacity() < 100) return [];

		const options: FactoryDestinationTask[] = [];
		const missingResources = this.room.factoryManager.getMissingComponents();
		if (!missingResources) return [];

		let resourceType: ResourceConstant;
		for (resourceType in missingResources) {
			if (context.resourceType && resourceType !== context.resourceType) continue;

			// @todo Create only one task, but allow picking up multiple resource types when resolving.
			const option = {
				type: this.getType(),
				priority: 3,
				weight: missingResources[resourceType] / 1000,
				resourceType,
				amount: missingResources[resourceType],
				target: this.room.factory.id,
			};

			if (option.amount < 100) option.priority--;
			if (option.amount < 10) option.priority--;

			options.push(option);
		}

		return options;
	}
}
