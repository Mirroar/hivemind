import StructureSource from 'dispatcher/resource-source/structure';

interface ContainerSourceTask extends StructureSourceTask {
	type: 'container';
	target: Id<StructureContainer>;
}

export default class ContainerSource extends StructureSource<ContainerSourceTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'container' {
		return 'container';
	}

	getHighestPriority() {
		return 4;
	}

	getTasks(context: ResourceSourceContext) {
		const options: ContainerSourceTask[] = [];

		this.addContainerEnergySourceOptions(options, context);

		return options;
	}

	private addContainerEnergySourceOptions(options: ContainerSourceTask[], context: ResourceSourceContext) {
		const creep = context.creep;
		if (context.resourceType && context.resourceType !== RESOURCE_ENERGY) return;

		// Look for energy in Containers.
		const targets = _.filter(this.room.structuresByType[STRUCTURE_CONTAINER], structure => structure.store[RESOURCE_ENERGY] > creep.store.getCapacity() * 0.1);

		// Prefer containers used as harvester dropoff.
		for (const target of targets) {
			const option: ContainerSourceTask = {
				priority: 1,
				weight: target.store[RESOURCE_ENERGY] / 100, // @todo Also factor in distance.
				type: this.getType(),
				target: target.id,
				resourceType: RESOURCE_ENERGY,
			};

			// Don't use the controller container as a normal source if we're upgrading.
			if (
				target.id === this.room.memory.controllerContainer
				&& (this.room.creepsByRole.upgrader || this.room.creepsByRole.builder)
				&& creep.memory.role === 'transporter'
			) {
				if (this.room.energyAvailable === this.room.energyCapacityAvailable) continue;
				continue;
			}

			for (const source of target.room.sources) {
				if (source.getNearbyContainer()?.id !== target.id) continue;

				option.priority++;
				if (target.store.getUsedCapacity() >= creep.store.getFreeCapacity() // This container is filling up, prioritize emptying it when we aren't
					// busy filling extensions.
					&& (this.room.energyAvailable >= this.room.energyCapacityAvailable || !this.room.storage || creep.memory.role !== 'transporter')) option.priority += 2;

				break;
			}

			for (const bay of target.room.bays) {
				if (bay.pos.getRangeTo(target.pos) > 0) continue;
				if (!target.room.roomPlanner) continue;
				if (!target.room.roomPlanner.isPlannedLocation(target.pos, 'harvester')) continue;

				if (target.store.getUsedCapacity() < target.store.getCapacity() / 3) {
					// Do not empty containers in harvester bays for quicker extension refills.
					option.priority = -1;
				}

				break;
			}

			option.priority -= this.room.getCreepsWithOrder('container', target.id).length * 3;

			options.push(option);
		}
	}
}
