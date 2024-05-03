import StructureDestination from 'dispatcher/resource-destination/structure';

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

		return this.cacheEmptyTaskListFor('', 5, () => {
			const options: SpawnDestinationTask[] = [];

			const targetSpawns = _.filter(this.room.myStructuresByType[STRUCTURE_SPAWN], structure =>
				(!structure.isBaySpawn() || this.room.controller.level < 3)
				&& structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
			const targetExtensions = _.filter(this.room.myStructuresByType[STRUCTURE_EXTENSION], structure =>
				!structure.isBayExtension()
				&& structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
			const targets = [...targetSpawns, ...targetExtensions];

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
				option.priority -= _.filter(this.room.getCreepsWithOrder(this.getType(), target.id), c => c.memory.role === 'transporter').length * 3;

				options.push(option);
			}

			return options;
		});
	}
}
