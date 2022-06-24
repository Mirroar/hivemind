function getResourcesIn(store: StoreDefinition | Record<string, number>): ResourceConstant[] {
	return _.keys(store) as ResourceConstant[];
}

export {
	getResourcesIn,
};
