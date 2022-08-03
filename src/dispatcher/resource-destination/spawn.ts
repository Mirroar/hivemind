import TaskProvider from 'dispatcher/task-provider';

declare global {
	interface SpawnDestinationTask extends StructureDestinationTask {
		type: 'spawn';
		target: Id<StructureSpawn | StructureExtension>;
	}
}

export default class SpawnDestination implements TaskProvider<SpawnDestinationTask, ResourceDestinationContext> {
	constructor(readonly room: Room) {}

	getType(): 'spawn' {
		return 'spawn';
	}

	getHighestPriority() {
		return 5;
	}

	getTasks(context?: ResourceDestinationContext) {
		if (context.resourceType && context.resourceType !== RESOURCE_ENERGY) return [];
		if (context.creep && context.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) return [];

		const options: SpawnDestinationTask[] = [];

		const targets = this.room.find<StructureExtension | StructureSpawn>(FIND_STRUCTURES, {
			filter: structure => {
				return (
					(structure.structureType === STRUCTURE_EXTENSION && !structure.isBayExtension()) ||
					(structure.structureType === STRUCTURE_SPAWN && (!structure.isBaySpawn() || this.room.controller.level < 3))) &&
					structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
			},
		});

		for (const target of targets) {
			const option: SpawnDestinationTask = {
				priority: target.structureType === STRUCTURE_SPAWN ? 5 : 4,
				weight: 0,
				type: this.getType(),
				target: target.id,
				resourceType: RESOURCE_ENERGY,
				amount: target.store.getFreeCapacity(RESOURCE_ENERGY),
			};

			if (context.creep) {
				const canDeliver = Math.min(context.creep.store[RESOURCE_ENERGY] || 0, target.store.getFreeCapacity(RESOURCE_ENERGY));
				option.weight += canDeliver / (context.creep.store.getCapacity()) + 1 - (context.creep.pos.getRangeTo(target) / 100);
			}

			option.priority -= this.room.getCreepsWithOrder('deliver', target.id).length * 3;

			options.push(option);
		}

		return options;
	}

	validate(task: SpawnDestinationTask) {
		const structure = Game.getObjectById(task.target);
		if (!structure) return false;
		if (structure.store.getFreeCapacity(task.resourceType) === 0) return false;

		return true;
	}
}
