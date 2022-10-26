import TaskProvider from 'dispatcher/task-provider';

declare global {
	interface TowerDestinationTask extends StructureDestinationTask {
		type: 'tower';
		target: Id<StructureTower>;
	}
}

export default class TowerDestination implements TaskProvider<TowerDestinationTask, ResourceDestinationContext> {
	constructor(readonly room: Room) {}

	getType(): 'tower' {
		return 'tower';
	}

	getHighestPriority() {
		return 5;
	}

	getTasks(context?: ResourceDestinationContext) {
		if (context.resourceType && context.resourceType !== RESOURCE_ENERGY) return [];
		if (context.creep && context.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) return [];

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

	validate(task: TowerDestinationTask) {
		const tower = Game.getObjectById(task.target);
		if (!tower) return false;
		if (tower.store.getFreeCapacity(task.resourceType) === 0) return false;

		return true;
	}
}
