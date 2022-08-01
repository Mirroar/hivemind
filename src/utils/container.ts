export class Container {
	services: Map<string, unknown>;
	constructors: Map<string, (c: Container) => unknown>;

	constructor() {
		this.services = new Map();
		this.constructors = new Map();
	}

	get<T>(key: string): T {
		if (this.services.has(key)) return this.services.get(key) as T;
		if (!this.constructors.has(key)) throw 'Invalid service "' + key + '" requested';

		const instance = this.constructors.get(key)(this);
		this.services.set(key, instance);
		return instance as T;
	}

	set<T>(key: string, dependency: (c: Container) => T) {
		this.constructors.set(key, dependency);
		this.services.delete(key);
	}
}

export default new Container();
