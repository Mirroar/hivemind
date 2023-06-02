import StructureDestination from 'dispatcher/resource-destination/structure';

interface ContainerDestinationTask extends StructureDestinationTask {
	type: 'container';
	target: Id<StructureContainer>;
}

export default class ContainerDestination extends StructureDestination<ContainerDestinationTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'container' {
		return 'container';
	}

	getHighestPriority() {
		return 4;
	}

	getTasks(context: ResourceDestinationContext) {
		const options: ContainerDestinationTask[] = [];

		this.addControllerContainerTask(context, options);

		return options;
	}

	addControllerContainerTask(context: ResourceDestinationContext, options: ContainerDestinationTask[]) {
		if (context.resourceType && context.resourceType !== RESOURCE_ENERGY) return;
		if (!this.room.creepsByRole.upgrader && !this.room.creepsByRole.builder) return;

		const container = Game.getObjectById<StructureContainer>(this.room.memory.controllerContainer);
		if (!container) return;

		const option: ContainerDestinationTask = {
			priority: 4,
			weight: container.store.getFreeCapacity() / 100,
			type: this.getType(),
			target: container.id,
			resourceType: RESOURCE_ENERGY,
			amount: container.store.getFreeCapacity(),
		};

		let prioFactor = 1;
		if (container.store.getUsedCapacity() / container.store.getCapacity() > 0.75) {
			prioFactor = 3;
			option.priority--;
			option.priority--;
		}
		else if (container.store.getUsedCapacity() / container.store.getCapacity() > 0.5) {
			option.priority--;
			prioFactor = 2;
		}

		option.priority -= this.room.getCreepsWithOrder(this.getType(), container.id).length * prioFactor;

		options.push(option);
	}
}
