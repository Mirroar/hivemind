import Dispatcher from 'dispatcher/dispatcher';

import ContainerSource from 'dispatcher/resource-source/container';
import DropSource from 'dispatcher/resource-source/drop';
import FactorySource from 'dispatcher/resource-source/factory';
import GraveSource from 'dispatcher/resource-source/grave';
import LabSource from 'dispatcher/resource-source/lab';
import LinkSource from 'dispatcher/resource-source/link';
import OverfullExtensionSource from 'dispatcher/resource-source/overfull-extension';
import StorageSource from 'dispatcher/resource-source/storage';

declare global {
	interface ResourceSourceTask extends Task {
		resourceType: ResourceConstant;
		amount?: number;
	}

	interface ResourceSourceContext {
		resourceType?: ResourceConstant;
		creep: Creep;
	}
}

export default class ResourceSourceDispatcher extends Dispatcher<ResourceSourceTask, ResourceSourceContext> {
	constructor(readonly room: Room) {
		super();
		this.addProvider(new ContainerSource(room));
		this.addProvider(new DropSource(room));
		this.addProvider(new FactorySource(room));
		this.addProvider(new GraveSource(room));
		this.addProvider(new LabSource(room));
		this.addProvider(new LinkSource(room));
		this.addProvider(new OverfullExtensionSource(room));
		this.addProvider(new StorageSource(room));
	}
}
