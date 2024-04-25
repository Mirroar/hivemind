import settings from 'settings-manager';
import StructureDestination from 'dispatcher/resource-destination/structure';

interface NukerDestinationTask extends StructureDestinationTask {
	type: 'nuker';
	target: Id<StructureNuker>;
}

export default class NukerDestination extends StructureDestination<NukerDestinationTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'nuker' {
		return 'nuker';
	}

	getHighestPriority() {
		return 1;
	}

	getTasks(context: ResourceDestinationContext) {
		if (this.room.isEvacuating()) return [];

		return this.cacheEmptyTaskListFor(context.resourceType || '', 100, () => {
			const options: NukerDestinationTask[] = [];
			this.addResourceTask(RESOURCE_GHODIUM, options, context);

			if (this.room.getEffectiveAvailableEnergy() >= settings.get('minEnergyForNuker')) {
				this.addResourceTask(RESOURCE_ENERGY, options, context);
			}

			return options;
		});
	}

	addResourceTask(resourceType: RESOURCE_ENERGY | RESOURCE_GHODIUM, options: NukerDestinationTask[], context: ResourceDestinationContext) {
		const nuker = this.room.nuker;
		if (!nuker || !settings.get('constructNukers')) return;

		const freeCapacity = nuker.store.getFreeCapacity(resourceType);
		if (freeCapacity === 0) return;
		if (context.resourceType && context.resourceType !== resourceType) return;

		const option: NukerDestinationTask = {
			type: this.getType(),
			priority: 1,
			weight: freeCapacity / 100,
			resourceType,
			amount: freeCapacity,
			target: nuker.id,
		};

		option.priority -= this.room.getCreepsWithOrder(this.getType(), nuker.id).length * 2;

		options.push(option);
	}
}
