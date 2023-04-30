import StructureSource from 'dispatcher/resource-source/structure';
import TaskProvider from 'dispatcher/task-provider';
import {getResourcesIn} from 'utils/store';

interface StorageSourceTask extends StructureSourceTask {
	type: 'storage';
	target: Id<StructureStorage | StructureTerminal>;
}

export default class StorageSource extends StructureSource<StorageSourceTask> {
	constructor(readonly room: Room) {
		super(room);
	}

	getType(): 'storage' {
		return 'storage';
	}

	getHighestPriority(context?: ResourceSourceContext) {
		return Math.max(2, this.getEnergyPickupPriority(context));
	}

	getEnergyPickupPriority(context?: ResourceSourceContext): number {
		if (!context) return 0;
		if (context.resourceType && context.resourceType !== RESOURCE_ENERGY) return 0;
		if (context.creep.memory.role !== 'transporter') return 5;

		const room = context.creep.room;
		if (room.energyAvailable < room.energyCapacityAvailable * 0.9) {
			// Spawning is important, so get energy when needed.
			return 4;
		}

		if (room.terminal && room.storage && room.terminal.store.getFreeCapacity() > 5000 && room.terminal.store.energy < room.storage.store.energy * 0.05) {
			// Take some energy out of storage to put into terminal from time to time.
			return 2;
		}

		return 0;
	}

	getTasks(context: ResourceSourceContext) {
		if (!this.room.storage) return [];

		const options: StorageSourceTask[] = [];

		this.addStorageEnergySourceOptions(options, context);
		this.addClearingStorageResourceOptions(options, context);

		return options;
	}

	addStorageEnergySourceOptions(options: StorageSourceTask[], context: ResourceSourceContext) {
		if (context.resourceType && context.resourceType !== RESOURCE_ENERGY) return;
		const creep = context.creep;

		// Energy can be gotten at the room's storage or terminal.
		const storageTarget = creep.room.getBestStorageSource(RESOURCE_ENERGY);
		if (!storageTarget) return;

		// Only transporters can get the last bit of energy from storage, so spawning can always go on.
		if (creep.memory.role === 'transporter' || storageTarget.store[RESOURCE_ENERGY] > 5000 || !creep.room.storage || storageTarget.id !== creep.room.storage.id) {
			options.push({
				priority: this.getEnergyPickupPriority(context),
				weight: 0,
				type: 'storage',
				target: storageTarget.id,
				resourceType: RESOURCE_ENERGY,
			});
		}
	}

	addClearingStorageResourceOptions(options: StorageSourceTask[], context: ResourceSourceContext) {
		if (!this.room.isClearingStorage()) return;
		if (!this.room.terminal) return;

		const storage = this.room.storage;
		const terminal = this.room.terminal;
		if (terminal.store.getUsedCapacity() > terminal.store.getCapacity() * 0.95) return;

		for (const resourceType of getResourcesIn(storage.store)) {
			if (context.resourceType && resourceType !== context.resourceType) continue;

			options.push({
				priority: storage.store[resourceType] > context.creep.store.getCapacity() / 2 ? 2 : 1,
				weight: 0, // @todo Increase weight of more expensive resources.
				type: 'storage',
				target: storage.id,
				resourceType,
			});
		}
	}
}
