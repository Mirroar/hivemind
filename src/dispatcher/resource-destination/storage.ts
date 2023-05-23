import {getResourcesIn} from 'utils/store';
import StructureDestination from 'dispatcher/resource-destination/structure';

interface StorageDestinationTask extends StructureDestinationTask {
	type: 'storage';
	target: Id<AnyStoreStructure>;
}

export default class StorageDestination extends StructureDestination<StorageDestinationTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'storage' {
		return 'storage';
	}

	getHighestPriority() {
		return 0;
	}

	getTasks(context: ResourceDestinationContext) {
		const options: StorageDestinationTask[] = [];

		this.addStoreResourceTasks(context, options);

		return options;
	}

	addStoreResourceTasks(context: ResourceDestinationContext, options: StorageDestinationTask[]) {
		const creep = context.creep;

		for (const resourceType of getResourcesIn(creep.store)) {
			const storageTarget = creep.room.getBestStorageTarget(creep.store[resourceType], resourceType);
			if (!storageTarget) continue;

			options.push({
				priority: 0,
				weight: creep.store[resourceType] / 100,
				type: 'storage',
				target: storageTarget.id,
				resourceType,
				amount: creep.store[resourceType],
			});
		}
	}
}
