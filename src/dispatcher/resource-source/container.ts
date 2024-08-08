import StructureSource from 'dispatcher/resource-source/structure';
import { getResourcesIn } from 'utils/store';

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
		this.addContainerResourceSourceOptions(options, context);

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

	private addContainerResourceSourceOptions(options: ContainerSourceTask[], context: ResourceSourceContext) {
		const room = this.room;
		// We need a decent place to store these resources.
		if (!room.terminal && !room.storage) return;

		// Take non-energy out of containers.
		const containers = room.structuresByType[STRUCTURE_CONTAINER] || [];

		for (const container of containers) {
			const assignedResourceType = this.getAssignedResourceType(container);
			for (const resourceType of getResourcesIn(container.store)) {
				if (resourceType === RESOURCE_ENERGY) continue;
				if (container.store[resourceType] === 0) continue;
				if (
					resourceType === assignedResourceType
					&& container.store.getUsedCapacity(resourceType) < CONTAINER_CAPACITY / 2
				) continue;

				const option: ContainerSourceTask = {
					priority: 3,
					weight: container.store[resourceType] / 20, // @todo Also factor in distance.
					type: this.getType(),
					target: container.id,
					resourceType,
				};

				option.priority -= room.getCreepsWithOrder('container', container.id).length * 2;

				options.push(option);
			}
		}
	}

	private getAssignedResourceType(container: StructureContainer): ResourceConstant | null {
		for (const mineral of this.room.minerals) {
			if (container.id !== mineral.getNearbyContainer()?.id) continue;

			return mineral.mineralType;
		}

		return null;
	}
}
