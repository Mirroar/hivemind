import settings from 'settings-manager';
import TaskProvider from 'dispatcher/task-provider';

declare global {
	interface NukerDestinationTask extends StructureDestinationTask {
		type: 'nuker';
		target: Id<StructureNuker>;
	}
}

export default class NukerDestination implements TaskProvider<NukerDestinationTask, ResourceDestinationContext> {
	constructor(readonly room: Room) {}

	getType(): 'nuker' {
		return 'nuker';
	}

	getHighestPriority() {
		return 1;
	}

	getTasks(context?: ResourceDestinationContext) {
		if (this.room.isEvacuating()) return [];

		const options: NukerDestinationTask[] = [];
		this.addResourceTask(RESOURCE_GHODIUM, options, context);

		if (this.room.getCurrentResourceAmount(RESOURCE_ENERGY) >= settings.get('minEnergyForNuker'))
			this.addResourceTask(RESOURCE_ENERGY, options, context);

		return options;
	}

	addResourceTask(resourceType: RESOURCE_ENERGY | RESOURCE_GHODIUM, options: NukerDestinationTask[], context?: ResourceDestinationContext) {
		const nuker = this.room.nuker;
		if (!nuker) return;
		const freeCapacity = nuker.store.getFreeCapacity(resourceType);
		if (freeCapacity === 0) return;
		if (context.resourceType && context.resourceType !== resourceType) return;
		if (context.creep && context.creep.store.getUsedCapacity(resourceType) === 0) return;

		const option: NukerDestinationTask = {
			type: this.getType(),
			priority: 1,
			weight: freeCapacity / 100,
			resourceType: resourceType,
			amount: freeCapacity,
			target: nuker.id,
		};

		option.priority -= this.room.getCreepsWithOrder('deliver', nuker.id).length * 2;

		options.push(option);
	}

	validate(task: NukerDestinationTask) {
		const nuker = Game.getObjectById(task.target);
		if (!nuker) return false;
		if (nuker.store.getFreeCapacity(task.resourceType) === 0) return false;

		return true;
	}
}
