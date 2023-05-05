import TaskProvider from 'dispatcher/task-provider';

declare global {
	interface StructureSourceTask extends ResourceSourceTask {
		target: Id<AnyStoreStructure>;
	}
}

export default class StructureSource<TaskType extends StructureSourceTask> implements TaskProvider<TaskType, ResourceSourceContext> {
	constructor(readonly room: Room) {}

	getType() {
		return 'structure';
	}

	getHighestPriority() {
		return 0;
	}

	getTasks(context?: ResourceSourceContext) {
		return [];
	}

	isValid(task: TaskType, context: ResourceSourceContext) {
		const structure = Game.getObjectById(task.target);
		if (!structure) return false;
		if (structure.store.getUsedCapacity(task.resourceType) === 0) return false;
		if (context.creep.store.getFreeCapacity(task.resourceType) === 0) return false;

		return true;
	}

	execute(task: TaskType, context: ResourceSourceContext) {
		const creep = context.creep;
		const target = Game.getObjectById(task.target);

		creep.whenInRange(1, target, () => {
			const resourceType = task.resourceType;

			if (task.amount)
				creep.withdraw(target, resourceType, Math.min(target.store.getUsedCapacity(resourceType), creep.memory.order.amount, creep.store.getFreeCapacity()));
			else
				creep.withdraw(target, resourceType);

			delete creep.memory.order;
		});
	}
}
