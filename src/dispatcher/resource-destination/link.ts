import TaskProvider from 'dispatcher/task-provider';

declare global {
	interface LinkDestinationTask extends StructureDestinationTask {
		type: 'link';
		target: Id<StructureLink>;
	}
}

export default class LinkDestination implements TaskProvider<LinkDestinationTask, ResourceDestinationContext> {
	constructor(readonly room: Room) {}

	getType(): 'link' {
		return 'link';
	}

	getHighestPriority() {
		return 5;
	}

	getTasks(context?: ResourceDestinationContext) {
		if (!this.room.linkNetwork || this.room.linkNetwork.energy >= this.room.linkNetwork.minEnergy) return [];
		if (context.resourceType && context.resourceType !== RESOURCE_ENERGY) return [];
		if (context.creep && context.creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) return [];

		const options: LinkDestinationTask[] = [];

		for (const link of this.room.linkNetwork.neutralLinks) {
			const freeCapacity = link.store.getFreeCapacity(RESOURCE_ENERGY);
			if (freeCapacity === 0) continue;

			const option: LinkDestinationTask = {
				type: this.getType(),
				priority: 5,
				weight: freeCapacity / 100,
				resourceType: RESOURCE_ENERGY,
				amount: freeCapacity,
				target: link.id,
			};

			if (context.creep && context.creep.pos.getRangeTo(link) > 10) {
				// Don't go out of your way to fill the link, do it when nearby, e.g. at storage.
				option.priority--;
			}

			options.push(option);
		}

		return options;
	}

	validate(task: LinkDestinationTask) {
		const link = Game.getObjectById(task.target);
		if (!link) return false;
		if (link.store.getFreeCapacity(task.resourceType) === 0) return false;

		return true;
	}
}
