import Dispatcher from 'dispatcher/dispatcher';
import LinkSource from 'dispatcher/resource-source/link';
import FactorySource from 'dispatcher/resource-source/factory';
import StorageSource from 'dispatcher/resource-source/storage';

declare global {
	interface ResourceSourceTask extends Task {
		resourceType: ResourceConstant;
		amount?: number;
	}

	interface ResourceSourceContext {
		resourceType?: ResourceConstant;
		creep?: Creep;
	}
}

export default class ResourceSourceDispatcher extends Dispatcher<ResourceSourceTask, ResourceSourceContext> {
	constructor(readonly room: Room) {
		super();
		this.addProvider(new LinkSource(room));
		this.addProvider(new FactorySource(room));
		this.addProvider(new StorageSource(room));
	}
}
