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
		const options: LabSourceTask[] = [];

		this.addLabResourceOptions(options, context);

		// Get reaction resources.
		const roomMemory = this.room.memory;
		if (roomMemory?.labs && roomMemory?.currentReaction) {
			this.addSourceLabResourceOptions(options, Game.getObjectById<StructureLab>(roomMemory.labs.source1), roomMemory.currentReaction[0], context);
			this.addSourceLabResourceOptions(options, Game.getObjectById<StructureLab>(roomMemory.labs.source2), roomMemory.currentReaction[1], context);
		}

		return options;
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
		if (room.isEvacuating()) return;

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
					type: 'lab',
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

				if (currentReaction) {
					// If we're doing a different reaction now, clean out faster!
					if (REACTIONS[currentReaction[0]][currentReaction[1]] !== lab.mineralType) {
						option.priority = 3;
						option.weight = 0;
					}
				}

				option.priority -= this.room.getCreepsWithOrder(this.getType(), lab.id).length * 2;
				option.priority -= this.room.getCreepsWithOrder('getEnergy', lab.id).length * 2;
				option.priority -= this.room.getCreepsWithOrder('getResource', lab.id).length * 2;

				if (option.priority > 0) options.push(option);
			}
		}

		if (!currentReaction) return;

		// Clear out source labs with wrong resources.
		let lab = Game.getObjectById<StructureLab>(room.memory.labs.source1);
		if (lab?.mineralType && (!context.resourceType || context.resourceType === lab.mineralType) && lab.store[lab.mineralType] > 0 && lab.mineralType !== currentReaction[0]) {
			const option: LabSourceTask = {
				priority: 3,
				weight: 0,
				type: 'lab',
				target: lab.id,
				resourceType: lab.mineralType,
			};

			option.priority -= this.room.getCreepsWithOrder(this.getType(), lab.id).length * 2;
			option.priority -= this.room.getCreepsWithOrder('getEnergy', lab.id).length * 2;
			option.priority -= this.room.getCreepsWithOrder('getResource', lab.id).length * 2;

			options.push(option);
		}

		lab = Game.getObjectById<StructureLab>(room.memory.labs.source2);
		if (lab?.mineralType && (!context.resourceType || context.resourceType === lab.mineralType) && lab.store[lab.mineralType] > 0 && lab.mineralType !== currentReaction[1]) {
			const option: LabSourceTask = {
				priority: 3,
				weight: 0,
				type: 'lab',
				target: lab.id,
				resourceType: lab.mineralType,
			};

			option.priority -= this.room.getCreepsWithOrder(this.getType(), lab.id).length * 2;
			option.priority -= this.room.getCreepsWithOrder('getEnergy', lab.id).length * 2;
			option.priority -= this.room.getCreepsWithOrder('getResource', lab.id).length * 2;

			options.push(option);
		}
	}

	/**
	 * Adds options for getting reaction lab resources.
	 *
	 * @param {Array} options
	 *   A list of potential resource sources.
	 * @param {StructureLab} lab
	 *   The lab to fill.
	 * @param {string} resourceType
	 *   The type of resource that should be put in the lab.
	 */
	addSourceLabResourceOptions(options: LabSourceTask[], lab: StructureLab, resourceType: ResourceConstant, context: ResourceSourceContext) {
		if (!lab) return;
		if (lab.mineralType && lab.mineralType !== resourceType) return;
		if (lab.store[lab.mineralType] > lab.store.getCapacity(lab.mineralType) * 0.5) return;
		if (context.resourceType && context.resourceType !== resourceType) return;

		const source = this.room.getBestStorageSource(resourceType);
		if (!source) return;
		if ((source.store[resourceType] || 0) === 0) return;

		const option: LabSourceTask = {
			priority: 3,
			weight: 1 - (lab.store[lab.mineralType] / lab.store.getCapacity(lab.mineralType)),
			type: 'lab',
			target: source.id,
			resourceType,
		};

		if (lab.store[lab.mineralType] > lab.store.getCapacity(lab.mineralType) * 0.2) {
			option.priority--;
		}

		options.push(option);
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

			if (task.amount)
				creep.withdraw(target, resourceType, Math.min(target.store.getUsedCapacity(resourceType), creep.memory.order.amount, creep.store.getFreeCapacity()));
			else
				creep.withdraw(target, resourceType);

			delete creep.memory.order;
		});
	}
}
