import StructureSource from 'dispatcher/resource-source/structure';
import {getResourcesIn} from 'utils/store';

interface FactorySourceTask extends StructureSourceTask {
	type: 'factory';
	target: Id<AnyStoreStructure>;
}

export default class FactorySource extends StructureSource<FactorySourceTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'factory' {
		return 'factory';
	}

	getHighestPriority() {
		return 3;
	}

	getTasks(context: ResourceSourceContext) {
		if (!this.room.factory) return [];

		const options: FactorySourceTask[] = [];

		this.addNeededResourcesTasks(options, context);
		this.addEmptyFactoryTasks(options, context);

		return options;
	}

	addNeededResourcesTasks(options: FactorySourceTask[], context: ResourceSourceContext) {
		// @todo These will be obsolete once we automatically get resources from
		// storage when there is an unfulfilled destination task.
		const missingResources = this.room.factoryManager.getMissingComponents();
		if (!missingResources) return;

		const neededResources = this.room.factoryManager.getRequestedComponents() || {};

		let resourceType: ResourceConstant;
		for (resourceType in missingResources) {
			if (context.resourceType && resourceType !== context.resourceType) continue;

			// @todo Create only one task, but allow picking up multiple resource types when resolving.
			const structure = this.room.getBestStorageSource(resourceType);
			if (!structure) continue;

			const option = {
				type: this.getType(),
				priority: missingResources[resourceType] > 1000 ? 3 : 2,
				weight: missingResources[resourceType] / neededResources[resourceType],
				resourceType,
				target: structure.id,
				amount: structure.store.getUsedCapacity(resourceType),
			};

			if (option.amount < 100) option.priority--;

			options.push(option);
		}
	}

	addEmptyFactoryTasks(options: FactorySourceTask[], context: ResourceSourceContext) {
		const neededResources = this.room.factoryManager.getRequestedComponents() || {};

		for (const resourceType of getResourcesIn(this.room.factory.store)) {
			if (context.resourceType && resourceType !== context.resourceType) continue;
			if (neededResources[resourceType] && this.room.factory.store.getUsedCapacity(resourceType) <= neededResources[resourceType] * 1.5) continue;
			const storedAmount = this.room.factory.store.getUsedCapacity(resourceType);
			const extraAmount = storedAmount - (neededResources[resourceType] || 0);

			// @todo Create only one task, but allow picking up multiple resource types when resolving.
			const structure = this.room.factory;
			options.push({
				type: this.getType(),
				priority: (extraAmount > 1000 ? 3 : 2) - this.room.getCreepsWithOrder('factory', structure.id).length,
				weight: extraAmount / storedAmount,
				resourceType,
				target: structure.id,
				amount: extraAmount,
			});
		}
	}
}
