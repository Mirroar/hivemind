import StructureSource from 'dispatcher/resource-source/structure';

interface LabSourceTask extends StructureSourceTask {
	type: 'lab';
	target: Id<StructureLab | StructureStorage | StructureTerminal>;
}

export default class LabSource extends StructureSource<LabSourceTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'lab' {
		return 'lab';
	}

	getHighestPriority() {
		return 3;
	}

	getTasks(context: ResourceSourceContext) {
		if (this.room.isEvacuating()) return [];

		return this.cacheEmptyTaskListFor(context.resourceType || '', 25, () => {
			const options: LabSourceTask[] = [];

			this.addLabResourceOptions(options, context);
			this.addLabEvacuationOptions(options, context);

			return options;
		});
	}

	/**
	 * Adds options for picking up resources for lab management.
	 *
	 * @param {Array} options
	 *   A list of potential resource sources.
	 */
	addLabResourceOptions(options: LabSourceTask[], context: ResourceSourceContext) {
		const room = this.room;
		const currentReaction = room.memory.currentReaction;
		if (!room.memory.canPerformReactions) return;

		const labs = room.memory.labs.reactor;
		for (const labID of labs) {
			// Clear out reaction labs.
			// @todo collect job so that transporter empties any labs that need
			// it before doing another action.
			const lab = Game.getObjectById<StructureLab>(labID);
			if (!lab?.mineralType) continue;
			if (context.resourceType && context.resourceType !== lab.mineralType) continue;

			const mineralAmount = lab.store[lab.mineralType];
			const mineralCapacity = lab.store.getCapacity(lab.mineralType);
			if (lab && mineralAmount > 0) {
				if (room.boostManager.isLabUsedForBoosting(lab.id) && lab.mineralType === room.boostManager.getRequiredBoostType(lab.id)) continue;

				const option: LabSourceTask = {
					priority: 0,
					weight: mineralAmount / mineralCapacity,
					type: this.getType(),
					target: lab.id,
					resourceType: lab.mineralType,
				};

				if (mineralAmount > mineralCapacity * 0.8) {
					option.priority++;
				}

				if (mineralAmount > mineralCapacity * 0.9) {
					option.priority++;
				}

				if (mineralAmount > mineralCapacity * 0.95) {
					option.priority++;
				}

				if (currentReaction // If we're doing a different reaction now, clean out faster!
					&& REACTIONS[currentReaction[0]][currentReaction[1]] !== lab.mineralType) {
					option.priority = 3;
					option.weight = 0;
				}

				option.priority -= this.room.getCreepsWithOrder(this.getType(), lab.id).length * 2;

				if (option.priority > 0) options.push(option);
			}
		}

		if (!currentReaction) return;

		// Clear out source labs with wrong resources.
		this.addClearSourceLabOption(options, Game.getObjectById<StructureLab>(room.memory.labs.source1), context, currentReaction[0]);
		this.addClearSourceLabOption(options, Game.getObjectById<StructureLab>(room.memory.labs.source2), context, currentReaction[1]);
	}

	addClearSourceLabOption(options: LabSourceTask[], lab: StructureLab, context: ResourceSourceContext, resourceType: ResourceConstant) {
		if (!lab) return;
		if (!lab.mineralType) return;
		if (context.resourceType && context.resourceType !== lab.mineralType) return;
		if (lab.store.getUsedCapacity(lab.mineralType) === 0) return;
		if (lab.mineralType === resourceType) return;

		const option: LabSourceTask = {
			priority: 3,
			weight: 0,
			type: this.getType(),
			target: lab.id,
			resourceType: lab.mineralType,
		};

		option.priority -= this.room.getCreepsWithOrder(this.getType(), lab.id).length * 2;

		options.push(option);
	}

	addLabEvacuationOptions(options: LabSourceTask[], context: ResourceSourceContext) {
		if (!this.room.isEvacuating()) return;

		// Take everything out of labs.
		const labs = this.room.myStructuresByType[STRUCTURE_LAB] || [];
		for (const lab of labs) {
			if (this.room.boostManager.isLabUsedForBoosting(lab.id)) continue;

			if (lab.store[RESOURCE_ENERGY] > 0) {
				options.push({
					priority: 3 - this.room.getCreepsWithOrder(this.getType(), lab.id).length * 2,
					weight: 0,
					type: this.getType(),
					target: lab.id,
					resourceType: RESOURCE_ENERGY,
				});
			}

			if (lab.mineralType) {
				options.push({
					priority: 3 - this.room.getCreepsWithOrder(this.getType(), lab.id).length * 2,
					weight: 0,
					type: this.getType(),
					target: lab.id,
					resourceType: lab.mineralType,
				});
			}
		}
	}

	isValid(task: LabSourceTask, context: ResourceSourceContext) {
		if (!task.resourceType) return false;
		const structure = Game.getObjectById(task.target);
		if (!structure) return false;
		if (structure.store.getUsedCapacity(task.resourceType) === 0) return false;
		if (context.creep.store.getFreeCapacity(task.resourceType) === 0) return false;
		if (!this.isSafePosition(context.creep, structure.pos)) return false;

		return true;
	}

	execute(task: LabSourceTask, context: ResourceSourceContext) {
		const creep = context.creep;
		const target = Game.getObjectById(task.target);

		creep.whenInRange(1, target, () => {
			const resourceType = task.resourceType;

			if (task.amount) {
				creep.withdraw(target, resourceType, Math.min(target.store.getUsedCapacity(resourceType), creep.memory.order.amount, creep.store.getFreeCapacity()));
			}
			else {
				creep.withdraw(target, resourceType);
			}

			delete creep.memory.order;
		});
	}
}
