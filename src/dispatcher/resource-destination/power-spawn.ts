import balancer from 'excess-energy-balancer';
import settings from 'settings-manager';
import StructureDestination from 'dispatcher/resource-destination/structure';
import TaskProvider from 'dispatcher/task-provider';

interface PowerSpawnDestinationTask extends StructureDestinationTask {
	type: 'powerSpawn';
	target: Id<StructurePowerSpawn>;
}

export default class PowerSpawnDestination extends StructureDestination<PowerSpawnDestinationTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'powerSpawn' {
		return 'powerSpawn';
	}

	getHighestPriority() {
		return 3;
	}

	getTasks(context: ResourceDestinationContext) {
		if (this.room.isEvacuating()) return [];
		if (!balancer.maySpendEnergyOnPowerProcessing()) return [];

		const options: PowerSpawnDestinationTask[] = [];
		this.addResourceTask(RESOURCE_POWER, 0.9, options, context);

		if (this.room.getCurrentResourceAmount(RESOURCE_ENERGY) >= settings.get('minEnergyForPowerProcessing'))
			this.addResourceTask(RESOURCE_ENERGY, 0.2, options, context);

		return options;
	}

	addResourceTask(resourceType: RESOURCE_ENERGY | RESOURCE_POWER, minFreeLevel: number, options: PowerSpawnDestinationTask[], context: ResourceDestinationContext) {
		const powerSpawn = this.room.powerSpawn;
		if (!powerSpawn) return;

		const freeCapacity = powerSpawn.store.getFreeCapacity(resourceType);
		if (freeCapacity < powerSpawn.store.getCapacity(resourceType) * minFreeLevel) return;
		if (context.resourceType && context.resourceType !== resourceType) return;

		const option: PowerSpawnDestinationTask = {
			type: this.getType(),
			priority: 3,
			weight: freeCapacity / 100,
			resourceType: resourceType,
			amount: freeCapacity,
			target: powerSpawn.id,
		};

		option.priority -= this.room.getCreepsWithOrder(this.getType(), powerSpawn.id).length * 2;

		options.push(option);
	}
}
