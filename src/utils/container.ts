declare global {
	interface DependencyInjectionContainer {
	}

	namespace NodeJS {
		interface Global {
			container: typeof container;
		}
	}
}

type ContainerConstructors = {
	[key in keyof DependencyInjectionContainer]: (c: Container) => DependencyInjectionContainer[key];
};

export class Container {
	services: DependencyInjectionContainer;
	constructors: ContainerConstructors;

	constructor() {
		this.services = {} as DependencyInjectionContainer;
		this.constructors = {} as ContainerConstructors;
	}

	get<T extends keyof DependencyInjectionContainer>(key: T): DependencyInjectionContainer[T] {
		if (this.services[key]) return this.services[key];
		if (!this.constructors[key]) throw 'Invalid service "' + key + '" requested';

		const instance = this.constructors[key](this) as DependencyInjectionContainer[T];
		this.services[key] = instance;
		return instance;
	}

	set<T extends keyof DependencyInjectionContainer>(key: T, generator: (c: Container) => DependencyInjectionContainer[T]) {
		// @todo Find out if we can get rid of this ugly typecast.
		this.constructors[key] = generator as typeof this.constructors[T];
		delete this.services[key];
	}
}

const container = new Container();
global.container = container;
export default container;
