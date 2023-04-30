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
}
