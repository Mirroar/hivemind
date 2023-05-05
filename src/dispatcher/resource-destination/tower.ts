import StructureDestination from 'dispatcher/resource-destination/structure';
import TaskProvider from 'dispatcher/task-provider';

interface TowerDestinationTask extends StructureDestinationTask {
	type: 'tower';
	target: Id<StructureTower>;
}

export default class TowerDestination extends StructureDestination<TowerDestinationTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'tower' {
		return 'tower';
	}

	getHighestPriority() {
		return 5;
	}

	getTasks(context: ResourceDestinationContext): TowerDestinationTask[] {
		if (context.resourceType && context.resourceType !== RESOURCE_ENERGY) return [];

		const options: TowerDestinationTask[] = [];

		const unfilledTowers = this.room.find<StructureTower>(FIND_STRUCTURES, {
			filter: structure => (structure.structureType === STRUCTURE_TOWER) && structure.store[RESOURCE_ENERGY] < structure.store.getCapacity(RESOURCE_ENERGY) * 0.8,
		});

		for (const tower of unfilledTowers) {
			const option: TowerDestinationTask = {
				priority: 3,
				weight: (tower.store.getCapacity(RESOURCE_ENERGY) - tower.store[RESOURCE_ENERGY]) / 100,
				type: this.getType(),
				target: tower.id,
				resourceType: RESOURCE_ENERGY,
				amount: tower.store.getCapacity(RESOURCE_ENERGY) - tower.store[RESOURCE_ENERGY],
			};

			if (this.room.memory.enemies && !this.room.memory.enemies.safe) {
				option.priority++;
			}

			if (tower.store[RESOURCE_ENERGY] < tower.store.getCapacity(RESOURCE_ENERGY) * 0.2) {
				option.priority++;
			}

			option.priority -= this.room.getCreepsWithOrder(this.getType(), tower.id).length * 2;

			options.push(option);
		}

		return options;
	}
}
