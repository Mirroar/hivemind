import cache from 'utils/cache';
import StructureDestination from 'dispatcher/resource-destination/structure';
import utilities from 'utilities';

interface ContainerDestinationTask extends StructureDestinationTask {
	type: 'container';
	target: Id<StructureContainer>;
}

export default class ContainerDestination extends StructureDestination<ContainerDestinationTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'container' {
		return 'container';
	}

	getHighestPriority() {
		return 4;
	}

	getTasks(context: ResourceDestinationContext) {
		const options: ContainerDestinationTask[] = [];

		this.addControllerContainerTask(context, options);

		return options;
	}

	addControllerContainerTask(context: ResourceDestinationContext, options: ContainerDestinationTask[]) {
		if (context.resourceType && context.resourceType !== RESOURCE_ENERGY) return;
		if (!this.room.creepsByRole.upgrader && !this.room.creepsByRole.builder) return;

		const container = Game.getObjectById<StructureContainer>(this.room.memory.controllerContainer);
		if (!container) return;

		// @todo Take into account boosts.
		const upgraderWorkParts = _.sum(this.room.creepsByRole.upgrader, creep => creep.getActiveBodyparts(WORK));
		const refillPathLength = cache.inHeap('ccRefillPathLength:' + this.room.name, 5000, () => {
			const path = utilities.getPath(this.room.getStorageLocation(), container.pos, false, {singleRoom: this.room.name});

			if (path.incomplete) return 1;
			return path.path.length;
		});

		const usedEnergyUntilArrival = upgraderWorkParts * UPGRADE_CONTROLLER_POWER * refillPathLength;
		const otherDeliveringCreeps = this.room.getCreepsWithOrder(this.getType(), container.id);
		const totalNeededEnergy = container.store.getFreeCapacity() + usedEnergyUntilArrival - _.sum(otherDeliveringCreeps, c => c.store.getUsedCapacity(RESOURCE_ENERGY));

		const option: ContainerDestinationTask = {
			priority: 4,
			weight: totalNeededEnergy / 100,
			type: this.getType(),
			target: container.id,
			resourceType: RESOURCE_ENERGY,
			amount: totalNeededEnergy,
		};

		let prioFactor = 1;
		if (totalNeededEnergy / container.store.getCapacity() < 0.75) {
			prioFactor = 3;
			option.priority--;
			option.priority--;
		}
		else if (totalNeededEnergy / container.store.getCapacity() < 0.5) {
			option.priority--;
			prioFactor = 2;
		}

		options.push(option);
	}

	isValid(task: ContainerDestinationTask, context: ResourceDestinationContext) {
		// We need an adjusted `isValid` check because even if the container is full, the task might still be valid.
		const structure = Game.getObjectById(task.target);
		if (!structure) return false;
		if (context.creep.memory.singleRoom && structure.pos.roomName !== context.creep.memory.singleRoom) return false;
		if (context.creep.store.getUsedCapacity(task.resourceType) === 0) return false;

		// Full container only invalidates this task if we're already there.
		if (structure.store.getFreeCapacity(task.resourceType) === 0 && context.creep.pos.getRangeTo(structure.pos) === 1) return false;

		// @todo Take into account boosts.
		const upgraderWorkParts = _.sum(this.room.creepsByRole.upgrader, creep => creep.getActiveBodyparts(WORK));
		const refillPathLength = context.creep.pos.getRangeTo(structure.pos);
		const usedEnergyUntilArrival = upgraderWorkParts * UPGRADE_CONTROLLER_POWER * refillPathLength;
		const otherDeliveringCreeps = this.room.getCreepsWithOrder(this.getType(), task.target);
		const totalNeededEnergy = structure.store.getFreeCapacity() + usedEnergyUntilArrival - _.sum(otherDeliveringCreeps, c => {
			if (c.id === context.creep.id) return 0;
			if (c.pos.getRangeTo(structure.pos) > refillPathLength) return 0;

			return c.store.getUsedCapacity(RESOURCE_ENERGY);
		});
		if (totalNeededEnergy <= 0) return false;

		return true;
	}
}
