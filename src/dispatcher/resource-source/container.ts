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

		this.emptyEnergyFromContainers(options, context);
		this.emptyResourcesFromContainers(options, context);

		return options;
	}

	private emptyEnergyFromContainers(options: ContainerSourceTask[], context: ResourceSourceContext) {
		const creep = context.creep;
		if (context.resourceType && context.resourceType !== RESOURCE_ENERGY) return;

		// Look for energy in Containers.
		const containers = _.filter(this.room.structuresByType[STRUCTURE_CONTAINER], structure => structure.store[RESOURCE_ENERGY] > creep.store.getCapacity() * 0.1);

		// Prefer containers used as harvester dropoff.
		for (const container of containers) {
			const option: ContainerSourceTask = {
				priority: 1,
				weight: container.store[RESOURCE_ENERGY] / 100, // @todo Also factor in distance.
				type: this.getType(),
				target: container.id,
				resourceType: RESOURCE_ENERGY,
			};

			// Don't use the controller container as a normal source if we're upgrading.
			if (
				container.id === this.room.memory.controllerContainer
				&& (this.room.creepsByRole.upgrader || this.room.creepsByRole.builder)
				&& creep.memory.role === 'transporter'
			) {
				continue;
			}

			for (const source of container.room.sources) {
				if (source.getNearbyContainer()?.id !== container.id) continue;

				option.priority++;
				if (container.store.getUsedCapacity() >= creep.store.getFreeCapacity() // This container is filling up, prioritize emptying it when we aren't
					// busy filling extensions.
					&& (this.room.energyAvailable >= this.room.energyCapacityAvailable || !this.room.storage || creep.memory.role !== 'transporter')) option.priority += 2;

				break;
			}

			for (const bay of container.room.bays) {
				if (bay.pos.getRangeTo(container.pos) > 0) continue;
				if (!container.room.roomPlanner) continue;
				if (!container.room.roomPlanner.isPlannedLocation(container.pos, 'harvester')) continue;

				if (container.store.getUsedCapacity() < container.store.getCapacity() / 3) {
					// Do not empty containers in harvester bays for quicker extension refills.
					option.priority = -1;
				}

				break;
			}

			option.priority -= this.room.getCreepsWithOrder('container', container.id).length * 3;

			options.push(option);
		}
	}

	private emptyResourcesFromContainers(options: ContainerSourceTask[], context: ResourceSourceContext) {
		const room = this.room;
		// We need a decent place to store these resources.
		if (!room.terminal && !room.storage) return;

		// Take non-energy out of containers.
		const containers = _.filter(room.structuresByType[STRUCTURE_CONTAINER], structure => structure.store.getUsedCapacity() > 0);

		for (const container of containers) {
			const assignedResourceType = this.getAssignedResourceType(container);
			for (const resourceType of getResourcesIn(container.store)) {
				if (container.store.getUsedCapacity(resourceType) === 0) continue;
				if (context.resourceType && context.resourceType !== resourceType) continue;

				// Energy is handled separately.
				if (resourceType === RESOURCE_ENERGY) continue;

				// Only take out the assigned resource type if the container is getting close to full.
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
