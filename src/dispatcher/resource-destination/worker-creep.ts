import TaskProvider from 'dispatcher/task-provider';

interface WorkerCreepDestinationTask extends ResourceDestinationTask {
	type: 'workerCreep';
	target: Id<Creep>;
}

export default class WorkerCreepDestination implements TaskProvider<WorkerCreepDestinationTask, ResourceDestinationContext> {
	constructor(readonly room: Room) {}

	getType(): 'workerCreep' {
		return 'workerCreep';
	}

	getHighestPriority() {
		return 2;
	}

	getTasks(context: ResourceDestinationContext) {
		if (context.resourceType && context.resourceType !== RESOURCE_ENERGY) return [];
		if (this.room.storage || this.room.terminal) return [];

		const options: WorkerCreepDestinationTask[] = [];

		const targetRoleWeights = {
			'builder.remote': 2,
			builder: 1.5,
			upgrader: 0.5,
		};

		for (const role in targetRoleWeights) {
			this.addRoleTasks(options, role, targetRoleWeights[role], context);
		}

		return options;
	}

	private addRoleTasks(options: WorkerCreepDestinationTask[], role: string, weight: number, context: ResourceDestinationContext) {
		for (const creep of _.values<Creep>(this.room.creepsByRole[role])) {
			if (creep.spawning) continue;
			if (creep.store.getFreeCapacity(RESOURCE_ENERGY) < creep.store.getCapacity(RESOURCE_ENERGY) / 3) continue;

			options.push({
				type: 'workerCreep',
				resourceType: RESOURCE_ENERGY,
				priority: 2 - this.room.getCreepsWithOrder(this.getType(), creep.id).length * 3,
				weight: weight + Math.min(1, creep.store.getFreeCapacity(RESOURCE_ENERGY) / context.creep.store.getUsedCapacity(RESOURCE_ENERGY)),
				target: creep.id,
				amount: context.creep.store.getUsedCapacity(RESOURCE_ENERGY),
			});
		}
	}

	isValid(task: WorkerCreepDestinationTask, context: ResourceDestinationContext) {
		const target = Game.getObjectById(task.target);
		if (!target) return false;
		if (target.spawning) return false;
		if (target.store.getFreeCapacity(task.resourceType) < target.store.getCapacity(RESOURCE_ENERGY) / 5) return false;
		if (target.room.name !== context.creep.room.name) return false;
		if (!context.creep.store[task.resourceType]) return false;

		return true;
	}

	execute(task: WorkerCreepDestinationTask, context: ResourceDestinationContext) {
		const creep = context.creep;
		const target = Game.getObjectById(task.target);
		creep.whenInRange(1, target, () => {
			if (task.amount) {
				creep.transfer(target, task.resourceType, Math.min(task.amount, creep.store.getUsedCapacity(task.resourceType), target.store.getFreeCapacity(task.resourceType)));
			}
			else {
				creep.transfer(target, task.resourceType);
			}

			delete creep.memory.order;
		});
	}
}
