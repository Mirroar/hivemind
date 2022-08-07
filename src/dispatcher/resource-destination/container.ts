import TaskProvider from 'dispatcher/task-provider';

declare global {
	interface ContainerDestinationTask extends StructureDestinationTask {
		type: 'container';
		target: Id<StructureContainer>;
	}
}

export default class ContainerDestination implements TaskProvider<ContainerDestinationTask, ResourceDestinationContext> {
	constructor(readonly room: Room) {}

	getType(): 'container' {
		return 'container';
	}

	getHighestPriority() {
		return 4;
	}

	getTasks(context?: ResourceDestinationContext) {
		if (context.resourceType && context.resourceType !== RESOURCE_ENERGY) return [];
		if (context.creep && context.creep.store[RESOURCE_ENERGY] === 0) return [];

		const options: ContainerDestinationTask[] = [];

		const targets = this.room.find<StructureContainer>(FIND_STRUCTURES, {
			filter: structure => {
				if (structure.structureType !== STRUCTURE_CONTAINER || structure.store.getFreeCapacity() === 0) return false;

				// Do deliver to controller containers when it is needed.
				// @todo Hand off energy to upgrader creeps in range.
				if (structure.id === structure.room.memory.controllerContainer) {
					if (this.room.creepsByRole.upgrader) return true;
					return false;
				}

				// Do not deliver to containers used as harvester drop off points.
				if (structure.room.sources) {
					for (const source of structure.room.sources) {
						const container = source.getNearbyContainer();
						if (container && container.id === structure.id) {
							return false;
						}
					}

					if (structure.room.mineral) {
						const container = structure.room.mineral.getNearbyContainer();
						if (container && container.id === structure.id) {
							return false;
						}
					}
				}

				// Allow delivery to any other container.
				return true;
			},
		});

		for (const target of targets) {
			const option: ContainerDestinationTask = {
				priority: 4,
				weight: target.store.getFreeCapacity() / 100,
				type: this.getType(),
				target: target.id,
				resourceType: RESOURCE_ENERGY,
				amount: target.store.getFreeCapacity(),
			};

			let prioFactor = 1;
			if (target.store.getUsedCapacity() / target.store.getCapacity() > 0.75) {
				prioFactor = 3;
				option.priority--;
			}
			else if (target.store.getUsedCapacity() / target.store.getCapacity() > 0.5) {
				prioFactor = 2;
			}

			option.priority -= this.room.getCreepsWithOrder('deliver', target.id).length * prioFactor;

			options.push(option);
		}

		return options;
	}

	validate(task: ContainerDestinationTask) {
		const structure = Game.getObjectById(task.target);
		if (!structure) return false;
		if (structure.store.getFreeCapacity(task.resourceType) === 0) return false;

		return true;
	}
}
