import TaskProvider from 'dispatcher/task-provider';

interface FactorySourceTask extends ResourceSourceTask {
	type: 'factory';
	target: Id<AnyStoreStructure>;
}

export default class FactorySource implements TaskProvider<FactorySourceTask, ResourceSourceContext> {
	constructor(readonly room: Room) {}

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
		const missingResources = this.room.factoryManager.getMissingComponents();
		if (!missingResources) return;

		for (const resourceType in missingResources) {
			if (context.resourceType && resourceType !== context.resourceType) continue;

			// @todo Create only one task, but allow picking up multiple resource types when resolving.
			const structure = this.room.getBestStorageSource(resourceType);
			if (!structure) continue;

			options.push({
				type: this.getType(),
				priority: 2,
				weight: missingResources[resourceType] / 1000,
				resourceType,
				target: structure.id,
				amount: structure.store[resourceType] || 0,
			});
		}
	}

	addEmptyFactoryTasks(options: FactorySourceTask[], context: ResourceSourceContext) {
		const neededResources = this.room.factoryManager.getRequestedComponents() || {};

		for (const resourceType in this.room.factory.store) {
			if (context.resourceType && resourceType !== context.resourceType) continue;
			if (neededResources[resourceType]) continue;

			// @todo Create only one task, but allow picking up multiple resource types when resolving.
			const structure = this.room.factory;
			options.push({
				type: this.getType(),
				priority: structure.store.getUsedCapacity(resourceType as ResourceConstant) > 1000 ? 3 : 2,
				weight: 0,
				resourceType,
				target: structure.id,
				amount: structure.store[resourceType] || 0,
			});
		}
	}

	validate(task: FactorySourceTask) {
		if (!this.room.factory) return false;

		const structure = Game.getObjectById(task.target);
		if (!structure) return false;
		if ((structure.store[task.resourceType] || 0) === 0) return false;

		return true;
	}
}
