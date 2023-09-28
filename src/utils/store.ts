function getResourcesIn(store: StoreDefinition | Partial<Record<ResourceConstant, any>>): ResourceConstant[] {
	return _.keys(store) as ResourceConstant[];
}

export {
	getResourcesIn,
};
