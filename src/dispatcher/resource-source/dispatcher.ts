import Dispatcher from 'dispatcher/dispatcher';
import ContainerSource from 'dispatcher/resource-source/container';
import FactorySource from 'dispatcher/resource-source/factory';
import LabSource from 'dispatcher/resource-source/lab';
import LinkSource from 'dispatcher/resource-source/link';
import StorageSource from 'dispatcher/resource-source/storage';
import TerminalSource from 'dispatcher/resource-source/terminal';
import GraveSource from "./grave";
import DropSource from "./drop";

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
		this.addProvider(new ContainerSource(room));
		this.addProvider(new FactorySource(room));
		this.addProvider(new LabSource(room));
		this.addProvider(new LinkSource(room));
		this.addProvider(new StorageSource(room));
		this.addProvider(new TerminalSource(room));
		this.addProvider(new DropSource(room));
		this.addProvider(new GraveSource(room));
	}
}
