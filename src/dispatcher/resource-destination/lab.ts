import TaskProvider from 'dispatcher/task-provider';

declare global {
	interface LabDestinationTask extends StructureDestinationTask {
		type: 'lab';
		target: Id<StructureLab>;
	}
}

export default class LabDestination implements TaskProvider<LabDestinationTask, ResourceDestinationContext> {
	constructor(readonly room: Room) {}

	getType(): 'lab' {
		return 'lab';
	}

	getHighestPriority() {
		return 3;
	}

	getTasks(context?: ResourceDestinationContext) {
		if (!this.room.memory.currentReaction) return [];
		if (this.room.isEvacuating()) return [];

		const options: LabDestinationTask[] = [];

		this.addLabTask(this.room.memory.currentReaction[0], this.room.memory.labs.source1, options, context);
		this.addLabTask(this.room.memory.currentReaction[1], this.room.memory.labs.source2, options, context);

		return options;
	}

	addLabTask(resourceType: ResourceConstant, labId: Id<StructureLab>, options: LabDestinationTask[], context?: ResourceDestinationContext) {
		const lab = Game.getObjectById(labId);
		if (!lab) return;
		if (lab.mineralType && lab.mineralType !== resourceType) return;
		if (context.resourceType && resourceType !== context.resourceType) return;
		if (context.creep && context.creep.store[resourceType] === 0) return;

		const freeCapacity = lab.store.getFreeCapacity(resourceType);
		if (freeCapacity < lab.store.getCapacity(resourceType) * 0.2) return;

		options.push({
			priority: 3,
			weight: freeCapacity / 100,
			type: this.getType(),
			target: labId,
			resourceType,
			amount: freeCapacity,
		});
	}

	validate(task: LabDestinationTask) {
		const structure = Game.getObjectById(task.target);
		if (!structure) return false;
		if (structure.store.getFreeCapacity(task.resourceType) === 0) return false;

		return true;
	}
}
