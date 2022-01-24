import Dispatcher from 'dispatcher/dispatcher';
import FactorySource from 'dispatcher/resource-source/factory';

declare global {
  interface ResourceSourceTask extends Task {
    resourceType: string;
    amount?: number;
  }

  interface ResourceSourceContext extends Context {
    resourceType?: ResourceConstant;
    creep?: Creep;
  }
}

export default class ResourceSourceDispatcher extends Dispatcher<ResourceSourceTask, ResourceSourceContext> {
  constructor(readonly room: Room) {
    super();
    this.addProvider(new FactorySource(room));
  }
}
