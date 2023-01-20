import TaskProvider from 'dispatcher/task-provider';

declare global {
	interface LinkSourceTask extends ResourceSourceTask {
		type: 'link';
		target: Id<StructureLink>;
	}
}

export default class LinkSource implements TaskProvider<LinkSourceTask, ResourceSourceContext> {
	constructor(readonly room: Room) {}

	getType(): 'link' {
		return 'link';
	}

	getHighestPriority() {
		return 5;
	}

	getTasks(context: ResourceSourceContext) {
		if (!this.room.linkNetwork) return [];
		if (this.room.linkNetwork.energy <= this.room.linkNetwork.maxEnergy) return [];

		const options: LinkSourceTask[] = [];

		for (const link of this.room.linkNetwork.neutralLinks) {
			if (link.store[RESOURCE_ENERGY] === 0) continue;

			const option: LinkSourceTask = {
				priority: 5,
				weight: link.store[RESOURCE_ENERGY] / 100,
				type: this.getType(),
				target: link.id,
				resourceType: RESOURCE_ENERGY,
			};

			if (context.creep && context.creep.pos.getRangeTo(link) > 10) {
				// Don't go out of your way to empty the link, do it when nearby, e.g. at storage.
				option.priority--;
			}

			option.priority -= this.room.getCreepsWithOrder(this.getType(), link.id).length * 2;
			option.priority -= this.room.getCreepsWithOrder('getEnergy', link.id).length * 2;
			option.priority -= this.room.getCreepsWithOrder('getResource', link.id).length * 2;

			options.push(option);
		}

		return options;
	}

	validate(task: LinkSourceTask) {
		const structure = Game.getObjectById(task.target);
		if (!structure) return false;
		if (structure.store[task.resourceType] === 0) return false;

		return true;
	}
}
