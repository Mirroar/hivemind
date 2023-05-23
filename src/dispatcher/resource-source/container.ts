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

		// @todo
		// @todo Allow builders to take energy out of upgrader container at low prio.
		this.addContainerEnergySourceOptions(options, context);

		return options;
	}

	private addContainerEnergySourceOptions(options: ContainerSourceTask[], context: ResourceSourceContext) {
		const creep = context.creep;

		// Look for energy in Containers.
		const targets = creep.room.find<StructureContainer>(FIND_STRUCTURES, {
			filter: structure => (structure.structureType === STRUCTURE_CONTAINER)
				&& structure.store[RESOURCE_ENERGY] > creep.store.getCapacity() * 0.1,
		});

		// Prefer containers used as harvester dropoff.
		for (const target of targets) {
			// Don't use the controller container as a normal source if we're upgrading.
			if (target.id === target.room.memory.controllerContainer && (creep.room.creepsByRole.upgrader || creep.room.creepsByRole.builder) && creep.memory.role === 'transporter') continue;

			const option: ContainerSourceTask = {
				priority: 1,
				weight: target.store[RESOURCE_ENERGY] / 100, // @todo Also factor in distance.
				type: this.getType(),
				target: target.id,
				resourceType: RESOURCE_ENERGY,
			};

			for (const source of target.room.sources) {
				if (source.getNearbyContainer()?.id !== target.id) continue;

				option.priority++;
				if (target.store.getUsedCapacity() >= creep.store.getFreeCapacity()) {
					// This container is filling up, prioritize emptying it when we aren't
					// busy filling extensions.
					if (creep.room.energyAvailable >= creep.room.energyCapacityAvailable || !creep.room.storage || creep.memory.role !== 'transporter') option.priority += 2;
				}

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

			option.priority -= creep.room.getCreepsWithOrder('container', target.id).length * 3;

			options.push(option);
		}
	}
}
