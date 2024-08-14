import StructureDestination from 'dispatcher/resource-destination/structure';

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

		return this.cacheEmptyTaskListFor(context.resourceType || '', 5, () => {
			if (this.room.factory.store.getFreeCapacity() < 100) return [];

			const options: FactoryDestinationTask[] = [];
			const missingResources = this.room.factoryManager.getMissingComponents();
			if (!missingResources) return [];

			const neededResources = this.room.factoryManager.getRequestedComponents() || {};

			let resourceType: ResourceConstant;
			for (resourceType in missingResources) {
				if (context.resourceType && resourceType !== context.resourceType) continue;

				// @todo Create only one task, but allow picking up multiple resource types when resolving.
				const option: FactoryDestinationTask = {
					type: this.getType(),
					priority: 3,
					weight: missingResources[resourceType] / neededResources[resourceType],
					resourceType,
					amount: missingResources[resourceType],
					target: this.room.factory.id,
				};

				if (option.amount < 100) option.priority--;
				if (option.amount < 10) option.priority--;

				options.push(option);
			}

			return options;
		});
	}
}
