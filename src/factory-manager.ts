import cache from 'utils/cache';

declare global {
	type FactoryProductConstant = keyof typeof COMMODITIES;
	type FactoryComponentConstant = FactoryProductConstant | DepositConstant;
}

interface Recipe {
	level?: number;
	amount: number;
	cooldown: number;
	components: Partial<Record<FactoryComponentConstant, number>>;
}

const compressRecipes = {
	[RESOURCE_ENERGY]: RESOURCE_BATTERY,
	[RESOURCE_UTRIUM]: RESOURCE_UTRIUM_BAR,
	[RESOURCE_LEMERGIUM]: RESOURCE_LEMERGIUM_BAR,
	[RESOURCE_ZYNTHIUM]: RESOURCE_ZYNTHIUM_BAR,
	[RESOURCE_KEANIUM]: RESOURCE_KEANIUM_BAR,
	[RESOURCE_GHODIUM]: RESOURCE_GHODIUM_MELT,
	[RESOURCE_OXYGEN]: RESOURCE_OXIDANT,
	[RESOURCE_HYDROGEN]: RESOURCE_REDUCTANT,
	[RESOURCE_CATALYST]: RESOURCE_PURIFIER,
};

const uncompressRecipes = {};
for (const resourceType in compressRecipes) {
	uncompressRecipes[compressRecipes[resourceType]] = resourceType;
}

// We try to keep the factory occupied for this many ticks when filling it.
const factoryFillTime = 500;

export default class FactoryManager {
	room: Room;

	constructor(readonly roomName: string) {
		this.room = Game.rooms[roomName];
	}

	hasAllComponents(product: FactoryProductConstant): boolean {
		const recipe = COMMODITIES[product];
		if (!recipe) return false;

		let resourceType: FactoryComponentConstant;
		for (resourceType in recipe.components) {
			if (this.room.factory.store.getUsedCapacity(resourceType) < recipe.components[resourceType]) return false;
		}

		return true;
	}

	getMissingComponents(): Partial<Record<FactoryComponentConstant, number>> | null {
		const requestedResources = this.getRequestedComponents();
		const result: Partial<Record<FactoryComponentConstant, number>> = {};
		let hasNeed = false;

		let resourceType: FactoryComponentConstant;
		for (resourceType in requestedResources) {
			if ((this.room.factory.store[resourceType] || 0) > requestedResources[resourceType]) continue;

			result[resourceType] = requestedResources[resourceType] - (this.room.factory.store[resourceType] || 0);
			hasNeed = true;
		}

		return hasNeed ? result : null;
	}

	getRequestedComponents(): Partial<Record<FactoryComponentConstant, number>> {
		const neededResources = {};
		if (this.room.isEvacuating()) return neededResources;

		const jobs = this.getJobs();
		const numberJobs = _.size(jobs);

		let productName: FactoryProductConstant;
		for (productName in jobs) {
			const recipe = jobs[productName];

			const amount = Math.max(1, factoryFillTime / recipe.cooldown / numberJobs);
			let resourceType: FactoryComponentConstant;
			for (resourceType in recipe.components) {
				neededResources[resourceType] = (neededResources[resourceType] || 0) + Math.ceil(recipe.components[resourceType] * amount);
			}
		}

		return neededResources;
	}

	getJobs(): Partial<Record<FactoryProductConstant, Recipe>> {
		return cache.inHeap('factoryJobs:' + this.roomName, 50, () => {
			const result: Partial<Record<FactoryProductConstant, Recipe>> = {};
			let resourceType: FactoryProductConstant;
			for (resourceType in COMMODITIES) {
				const recipe: Recipe = COMMODITIES[resourceType];

				if (this.isRecipeAvailable(resourceType, recipe)) result[resourceType] = recipe;
			}

			return result;
		});
	}

	getFactoryLevel(): number {
		if (!this.room.factory) return 0;

		return this.room.factory.getEffectiveLevel();
	}

	isRecipeAvailable(resourceType: FactoryProductConstant, recipe: Recipe): boolean {
		if (recipe.level && recipe.level !== this.getFactoryLevel()) return false;

		// Compress resource at 95% storage capacity, uncompress under 5%.
		// @todo Turn into setting.
		const storageFull = this.room.getFreeStorage() - this.room.factory.store.getUsedCapacity() < this.room.getStorageLimit() * 0.05;
		const storageEmpty = this.room.getFreeStorage() - this.room.factory.store.getUsedCapacity() > this.room.getStorageLimit() * 0.95;
		const minRawMaterialRatio = 0.2;
		const maxRawMaterialRatio = 0.8;

		const storedEnergy = this.room.getStoredEnergy() + this.room.factory.store.getUsedCapacity(RESOURCE_ENERGY);
		const storedProduct = this.room.getCurrentResourceAmount(resourceType) + this.room.factory.store.getUsedCapacity(resourceType);
		const storedResource = this.room.getCurrentResourceAmount(uncompressRecipes[resourceType] || compressRecipes[resourceType]) + this.room.factory.store.getUsedCapacity(uncompressRecipes[resourceType] || compressRecipes[resourceType]);

		if (resourceType === RESOURCE_BATTERY) {
			const rawMaterialRatio = storedResource / Math.max(storedProduct + storedResource, 1);
			return (storedProduct < 500 || storageFull || rawMaterialRatio > maxRawMaterialRatio) && storedEnergy > 15_000;
		}

		if (resourceType === RESOURCE_ENERGY) {
			const rawMaterialRatio = storedProduct / Math.max(storedProduct + storedResource, 1);
			return (storedProduct < 10_000 || storageEmpty || rawMaterialRatio < minRawMaterialRatio) && storedResource > 100;
		}

		if (uncompressRecipes[resourceType]) {
			const rawMaterialRatio = storedResource / Math.max(storedProduct + storedResource, 1);
			return (storedProduct < 500 || storageFull || rawMaterialRatio > maxRawMaterialRatio) && storedResource > 5000 && storedEnergy > 5000;
		}

		if (compressRecipes[resourceType]) {
			const rawMaterialRatio = storedProduct / Math.max(storedProduct + storedResource, 1);
			return (storedProduct < 2000 || storageEmpty || rawMaterialRatio < minRawMaterialRatio) && storedResource > 100 && storedEnergy > 5000;
		}

		// @todo For level-based recipes, use empire-wide resource capabilities and request via terminal.
		return this.mayCreateCommodities(resourceType, recipe);
	}

	mayCreateCommodities(product: FactoryProductConstant, recipe: Recipe): boolean {
		const createdAmount = this.room.getCurrentResourceAmount(product) / recipe.amount;

		if (this.isMadeOnlyFromBasicResources(recipe)) {
			for (const resourceType in recipe.components) {
				const resourceAmount = this.room.getCurrentResourceAmount(resourceType) + this.room.factory.store.getUsedCapacity(resourceType as ResourceConstant);
				if (resourceAmount === 0) return false;
				if (resourceAmount < recipe.components[resourceType] * createdAmount * 5) return false;
			}

			return true;
		}

		return this.hasRequiredResources(recipe);
	}

	isMadeOnlyFromBasicResources(recipe: Recipe): boolean {
		for (const resourceType in recipe.components) {
			if (!compressRecipes[resourceType] && !uncompressRecipes[resourceType]) return false;
		}

		return true;
	}

	hasRequiredResources(recipe: Recipe): boolean {
		for (const resourceType in recipe.components) {
			if (this.room.getCurrentResourceAmount(resourceType) + this.room.factory.store.getUsedCapacity(resourceType as ResourceConstant) < recipe.components[resourceType]) return false;
		}

		return true;
	}
}
