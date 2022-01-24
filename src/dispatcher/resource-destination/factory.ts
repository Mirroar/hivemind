import TaskProvider from 'dispatcher/task-provider';

interface FactoryDestinationTask extends ResourceDestinationTask {
  type: 'factory';
  target: Id<StructureFactory>;
}

export default class FactoryDestination implements TaskProvider<FactoryDestinationTask, ResourceDestinationContext> {
  constructor(readonly room: Room) {}

  getType(): 'factory' {
    return 'factory';
  }

  getHighestPriority() {
    return 2;
  }

  getTasks(context?: ResourceDestinationContext) {
    if (!this.room.factory) return [];

    const options: FactoryDestinationTask[] = [];
    const missingResources = this.room.factoryManager.getMissingComponents();
    if (!missingResources) return [];

    for (const resourceType in missingResources) {
      if (context.resourceType && resourceType !== context.resourceType) continue;
      if (context.creep && context.creep.store.getUsedCapacity(resourceType as ResourceConstant) === 0) continue;

      // @todo Create only one task, but allow picking up multiple resource types when resolving.
      options.push({
        type: this.getType(),
        priority: 2,
        weight: missingResources[resourceType] / 1000,
        resourceType,
        amount: missingResources[resourceType],
        target: this.room.factory.id,
      });
    }

    return options;
  }

  validate(task: FactoryDestinationTask) {
    if (!this.room.factory) return false;
    if (this.room.factory.store.getFreeCapacity() === 0) return false;

    return true;
  }
}
