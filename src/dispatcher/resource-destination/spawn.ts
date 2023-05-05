import StructureDestination from 'dispatcher/resource-destination/structure';
import TaskProvider from 'dispatcher/task-provider';

interface SpawnDestinationTask extends StructureDestinationTask {
	type: 'spawn';
	target: Id<StructureSpawn | StructureExtension>;
}

export default class SpawnDestination extends StructureDestination<SpawnDestinationTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'spawn' {
		return 'spawn';
	}

	getHighestPriority() {
		return 5;
	}

	getTasks(context: ResourceDestinationContext) {
		if (context.resourceType && context.resourceType !== RESOURCE_ENERGY) return [];

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

			const deliveryAmount = Math.min(context.creep.store[RESOURCE_ENERGY] || 0, target.store.getFreeCapacity(RESOURCE_ENERGY));
			option.weight += deliveryAmount / (context.creep.store.getCapacity()) + 1 - (context.creep.pos.getRangeTo(target) / 100);
			option.priority -= this.room.getCreepsWithOrder(this.getType(), target.id).length * 3;

			options.push(option);
		}

		return options;
	}
}
