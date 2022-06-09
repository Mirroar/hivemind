function getResourcesIn(store: StoreDefinition): ResourceConstant[] {
	return _.keys(store) as ResourceConstant[];
}

export {
	getResourcesIn,
};
