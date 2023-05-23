import StructureDestination from 'dispatcher/resource-destination/structure';

interface LabDestinationTask extends StructureDestinationTask {
	type: 'lab';
	target: Id<StructureLab>;
}

export default class LabDestination extends StructureDestination<LabDestinationTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'lab' {
		return 'lab';
	}

	getHighestPriority() {
		return 3;
	}

	getTasks(context: ResourceDestinationContext) {
		if (!this.room.memory.currentReaction) return [];
		if (this.room.isEvacuating()) return [];

		const options: LabDestinationTask[] = [];

		this.addLabTask(this.room.memory.currentReaction[0], this.room.memory.labs.source1, options, context);
		this.addLabTask(this.room.memory.currentReaction[1], this.room.memory.labs.source2, options, context);

		return options;
	}

	addLabTask(resourceType: ResourceConstant, labId: Id<StructureLab>, options: LabDestinationTask[], context: ResourceDestinationContext) {
		const lab = Game.getObjectById(labId);
		if (!lab) return;
		if (lab.mineralType && lab.mineralType !== resourceType) return;
		if (context.resourceType && resourceType !== context.resourceType) return;

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

	isValid(task: LabDestinationTask, context: ResourceDestinationContext) {
		if (!super.isValid(task, context)) return false;

		const lab = Game.getObjectById(task.target);
		if (lab.mineralType && lab.mineralType !== task.resourceType) return false;

		return true;
	}
}
