import TaskProvider from 'dispatcher/task-provider';

declare global {
	interface BayDestinationTask extends ResourceDestinationTask {
		type: 'bay';
		name: string;
	}
}

export default class BayDestination implements TaskProvider<BayDestinationTask, ResourceDestinationContext> {
	constructor(readonly room: Room) {}

	getType(): 'bay' {
		return 'bay';
	}

	getHighestPriority() {
		return 5;
	}

	getTasks(context: ResourceDestinationContext) {
		if (context.resourceType && context.resourceType !== RESOURCE_ENERGY) return [];

		const options: BayDestinationTask[] = [];

		for (const bay of this.room.bays) {
			const option: BayDestinationTask = {
				priority: 5,
				weight: 0,
				type: 'bay',
				name: bay.name,
				resourceType: RESOURCE_ENERGY,
				amount: bay.energyCapacity - bay.energy,
			};

			const deliveryAmount = Math.min(context.creep.store[RESOURCE_ENERGY], bay.energyCapacity - bay.energy);
			option.weight += deliveryAmount / context.creep.store.getCapacity() + 1 - (context.creep.pos.getRangeTo(bay) / 100);
			option.priority -= this.room.getCreepsWithOrder(this.getType(), bay.name).length * 3;

			options.push(option);
		}

		return options;
	}

	isValid(task: BayDestinationTask, context: ResourceDestinationContext) {
		const bay = _.find(this.room.bays, b => b.name === task.name);
		if (!bay) return false;
		if (bay.energy >= bay.energyCapacity) return false;
		if (bay.hasHarvester()) return false;
		if (!context.creep.store[RESOURCE_ENERGY]) return false;

		return true;
	}

	execute(task: BayDestinationTask, context: ResourceDestinationContext) {
		const creep = context.creep;
		const target = _.find(creep.room.bays, bay => bay.name === task.name);
		creep.whenInRange(0, target.pos, () => {
			if (!target.refillFrom(creep)) {
				delete creep.memory.order;

				const exitPosition = target.getExitPosition();
				if (exitPosition) creep.move(creep.pos.getDirectionTo(exitPosition));
			}
		});

		if (creep.pos.getRangeTo(target.pos) > 0) {
			// See if we can refill some of the bay's structures while en route.
			for (const structure of target.extensions) {
				if (structure.store.getFreeCapacity(RESOURCE_ENERGY) === 0) continue;
				if (structure.structureType === STRUCTURE_CONTAINER) continue;
				if (structure.structureType === STRUCTURE_LINK) continue;
				if (structure.pos.getRangeTo(creep.pos) > 1) continue;

				creep.transfer(structure, RESOURCE_ENERGY);
				return;
			}
		}
	}
}
