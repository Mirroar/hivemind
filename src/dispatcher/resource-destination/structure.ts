import TaskProvider from 'dispatcher/task-provider';

declare global {
	interface StructureDestinationTask extends ResourceDestinationTask {
		target: Id<AnyStoreStructure>;
	}
}

export default class StructureDestination<TaskType extends StructureDestinationTask> implements TaskProvider<TaskType, ResourceDestinationContext> {
	constructor(readonly room: Room) {}

	getType() {
		return 'structure';
	}

	getHighestPriority() {
		return 0;
	}

	getTasks(context?: ResourceDestinationContext) {
		return [];
	}

	isValid(task: TaskType, context: ResourceDestinationContext) {
		const structure = Game.getObjectById(task.target);
		if (!structure) return false;
		if (structure.store.getFreeCapacity(task.resourceType) === 0) return false;
		if (context.creep.store.getUsedCapacity(task.resourceType) === 0) return false;

		return true;
	}
}
