import StructureDestination from 'dispatcher/resource-destination/structure';
import TaskProvider from 'dispatcher/task-provider';

interface LinkDestinationTask extends StructureDestinationTask {
	type: 'link';
	target: Id<StructureLink>;
}

export default class LinkDestination extends StructureDestination<LinkDestinationTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'link' {
		return 'link';
	}

	getHighestPriority() {
		return 5;
	}

	getTasks(context: ResourceDestinationContext) {
		if (!this.room.linkNetwork) return [];
		if (this.room.linkNetwork.energy >= this.room.linkNetwork.minEnergy) return [];
		if (context.resourceType && context.resourceType !== RESOURCE_ENERGY) return [];

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

			if (context.creep.pos.getRangeTo(link) > 10) {
				// Don't go out of your way to fill the link, do it when nearby, e.g. at storage.
				option.priority--;
			}

			options.push(option);
		}

		return options;
	}

	isValid(task: LinkDestinationTask, context: ResourceDestinationContext) {
		if (!super.isValid(task, context)) return false;
		if (!this.room.linkNetwork) return false;
		if (this.room.linkNetwork.energy >= this.room.linkNetwork.minEnergy) return false;

		return true;
	}
}
