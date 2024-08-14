import StructureSource from 'dispatcher/resource-source/structure';
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
		return 3;
	}

	getTasks(context: ResourceSourceContext) {
		if (!this.room.storage) return [];

		const options: StorageSourceTask[] = [];

		this.addStorageEnergySourceOptions(options, context);
		this.addResourceFallbackOptions(options, context);
		this.addClearingStorageResourceOptions(options, context);
		this.addClearingTerminalResourceOptions(options, context);

		return options;
	}

	addStorageEnergySourceOptions(options: StorageSourceTask[], context: ResourceSourceContext) {
		// We deliberately don't return tasks if no resource type is specified.
		if (context.resourceType !== RESOURCE_ENERGY) return;
		
		const creep = context.creep;

		// Energy can be gotten at the room's storage or terminal.
		const storageTarget = this.room.getBestStorageSource(RESOURCE_ENERGY);
		if (!storageTarget) return;

		// Only transporters can get the last bit of energy from storage, so spawning can always go on.
		if (creep.memory.role === 'transporter' || storageTarget.store[RESOURCE_ENERGY] > 5000 || !this.room.storage || storageTarget.id !== this.room.storage.id) {
			options.push({
				priority: 2,
				weight: 0,
				type: this.getType(),
				target: storageTarget.id,
				resourceType: RESOURCE_ENERGY,
			});
		}
	}

	addResourceFallbackOptions(options: StorageSourceTask[], context: ResourceSourceContext) {
		// If a resource type is specified, allow taking it from storage at priority 0.
		if (!context.resourceType) return;
		if (context.resourceType === RESOURCE_ENERGY) return;

		const storageTarget = this.room.getBestStorageSource(context.resourceType);
		if (!storageTarget) return;

		options.push({
			priority: 0,
			weight: 0,
			type: this.getType(),
			target: storageTarget.id,
			resourceType: context.resourceType,
		});
	}

	addClearingStorageResourceOptions(options: StorageSourceTask[], context: ResourceSourceContext) {
		if (!this.room.isClearingStorage()) return;
		if (!this.room.terminal) return;

		const storage = this.room.storage;
		const terminal = this.room.terminal;
		if (terminal.store.getUsedCapacity() > terminal.store.getCapacity() * 0.95) return;

		// Find resource with highest count and take that.
		let max = null;
		let maxResourceType = null;
		for (const resourceType of getResourcesIn(storage.store)) {
			if (context.resourceType && resourceType !== context.resourceType) continue;

			// Do not take out resources that would be put back right away.
			if (this.room.getBestStorageTarget(context.creep.store.getFreeCapacity(), resourceType)?.id === storage.id) continue;

			if (!max || terminal.store[resourceType] > max) {
				max = terminal.store[resourceType];
				maxResourceType = resourceType;
			}
		}

		if (!maxResourceType) return;

		options.push({
			priority: storage.store[maxResourceType] > context.creep.store.getCapacity() / 2 ? 2 : 1,
			weight: 0, // @todo Increase weight of more expensive resources.
			type: this.getType(),
			target: storage.id,
			resourceType: maxResourceType,
		});
	}

	addClearingTerminalResourceOptions(options: StorageSourceTask[], context: ResourceSourceContext) {
		const storage = this.room.storage;
		const terminal = this.room.terminal;

		// Clear out overfull terminal.
		const storageHasSpace = storage && storage.store.getFreeCapacity() >= 0 && !this.room.isClearingStorage();
		const noSpaceForEnergy = terminal && (terminal.store.getFreeCapacity() + terminal.store.getUsedCapacity(RESOURCE_ENERGY)) < 5000;
		if ((this.terminalNeedsClearing() && storageHasSpace) || noSpaceForEnergy) {
			// Find resource with highest count and take that.
			let max = null;
			let maxResourceType = null;
			for (const resourceType of getResourcesIn(terminal.store)) {
				if (context.resourceType && resourceType !== context.resourceType) continue;

				// Do not take out energy if there is enough in storage.
				if (!this.room.isClearingTerminal() && resourceType === RESOURCE_ENERGY && storage && storage.store[RESOURCE_ENERGY] > terminal.store[RESOURCE_ENERGY] * 5) continue;

				// Do not take out resources that should be sent away.
				if (resourceType === this.room.memory.fillTerminal) continue;

				// Do not take out resources that would be put back right away.
				if (this.room.getBestStorageTarget(context.creep.store.getFreeCapacity(), resourceType)?.id === terminal.id) continue;

				if (!max || terminal.store[resourceType] > max) {
					max = terminal.store[resourceType];
					maxResourceType = resourceType;
				}
			}

			if (!maxResourceType) return;

			const option: StorageSourceTask = {
				priority: 1,
				weight: 0,
				type: this.getType(),
				target: terminal.id,
				resourceType: maxResourceType,
			};

			if (this.room.isClearingTerminal() || noSpaceForEnergy) {
				option.priority += 2;
			}

			options.push(option);
		}
	}

	terminalNeedsClearing() {
		const terminal = this.room.terminal;
		return terminal
			&& (terminal.store.getUsedCapacity() > terminal.store.getCapacity() * 0.8 || this.room.isClearingTerminal())
			&& !this.room.isClearingStorage();
	}
}
