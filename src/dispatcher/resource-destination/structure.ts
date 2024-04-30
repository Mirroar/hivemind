import TaskProvider from 'dispatcher/task-provider';

declare global {
	interface StructureDestinationTask extends ResourceDestinationTask {
		target: Id<AnyStoreStructure>;
	}
}

export default class StructureDestination<TaskType extends StructureDestinationTask> extends TaskProvider<TaskType, ResourceDestinationContext> {
	constructor(readonly room: Room) {
		super();
	}

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
		if (!structure.isOperational()) return false;
		if (context.creep.memory.singleRoom && structure.pos.roomName !== context.creep.memory.singleRoom) return false;
		if (structure.store.getFreeCapacity(task.resourceType) === 0) return false;
		if (context.creep.store.getUsedCapacity(task.resourceType) === 0) return false;

		return true;
	}

	execute(task: TaskType, context: ResourceDestinationContext) {
		const creep = context.creep;
		const target = Game.getObjectById(task.target);

		creep.whenInRange(1, target, () => {
			if (task.amount) {
				creep.transfer(target, task.resourceType, Math.min(task.amount, creep.store.getUsedCapacity(task.resourceType), target.store.getFreeCapacity(task.resourceType)));
			}
			else {
				creep.transfer(target, task.resourceType);
			}

			delete creep.memory.order;
		});
	}
}
