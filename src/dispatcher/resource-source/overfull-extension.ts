import StructureSource from 'dispatcher/resource-source/structure';

interface OverfullExtensionSourceTask extends StructureSourceTask {
	type: 'overfullExtension';
	target: Id<StructureExtension>;
}

export default class OverfullExtensionSource extends StructureSource<OverfullExtensionSourceTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'overfullExtension' {
		return 'overfullExtension';
	}

	getHighestPriority() {
		return 3;
	}

	getTasks(context: ResourceSourceContext) {
		if (context.resourceType && context.resourceType !== RESOURCE_ENERGY) return [];

		return this.cacheEmptyTaskListFor('', 1500, () => {
			const options: OverfullExtensionSourceTask[] = [];

			for (const extension of this.room.structuresByType[STRUCTURE_EXTENSION] || []) {
				if (extension.store.getUsedCapacity(RESOURCE_ENERGY) <= extension.store.getCapacity(RESOURCE_ENERGY)) continue;

				const option: OverfullExtensionSourceTask = {
					priority: 3,
					weight: 1 - (context.creep.pos.getRangeTo(extension) / 100) - (extension.isOperational() ? 0 : 0.5),
					type: this.getType(),
					target: extension.id,
					resourceType: RESOURCE_ENERGY,
					amount: extension.store.getUsedCapacity(RESOURCE_ENERGY) - extension.store.getUsedCapacity(RESOURCE_ENERGY),
				};

				option.priority -= this.room.getCreepsWithOrder(this.getType(), extension.id).length * 2;
				option.priority -= this.room.getCreepsWithOrder('getEnergy', extension.id).length * 2;
				option.priority -= this.room.getCreepsWithOrder('getResource', extension.id).length * 2;

				options.push(option);
			}

			return options;
		});
	}
}
