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
		if (!this.room.factoryManager) return [];

		return this.cacheEmptyTaskListFor(context.resourceType || '', 25, () => {
			const options: FactorySourceTask[] = [];

			this.addEmptyFactoryTasks(options, context);

			return options;
		});
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
