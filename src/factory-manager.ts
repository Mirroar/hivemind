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
		const jobs = this.getJobs();
		const numberJobs = _.size(jobs);

		let productName: FactoryProductConstant;
		for (productName in jobs) {
			const recipe = jobs[productName];

			const amount = Math.max(1, factoryFillTime / recipe.cooldown / numberJobs);
			let resourceType: FactoryComponentConstant;
			for (resourceType in recipe.components) {
				neededResources[resourceType] = (neededResources[resourceType] || 0) + (recipe.components[resourceType] * amount);
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

		if (resourceType === RESOURCE_BATTERY) {
			return (this.room.getCurrentResourceAmount(resourceType) < 500 && this.room.getStoredEnergy() > 15_000)
        || this.room.getStoredEnergy() > 150_000;
		}

		if (uncompressRecipes[resourceType]) {
			return (this.room.getCurrentResourceAmount(resourceType) < 500 && this.room.getCurrentResourceAmount(uncompressRecipes[resourceType]) > 5000 && this.room.getStoredEnergy() > 5000)
        || (this.room.getCurrentResourceAmount(uncompressRecipes[resourceType]) > 30_000 && this.room.getStoredEnergy() > 10_000);
		}

		if (compressRecipes[resourceType]) {
			return (this.room.getCurrentResourceAmount(resourceType) < 2000 && this.room.getCurrentResourceAmount(compressRecipes[resourceType]) >= 100 && this.room.getStoredEnergy() > 10_000)
        || (this.room.getCurrentResourceAmount(resourceType) < 10_000 && this.room.getCurrentResourceAmount(compressRecipes[resourceType]) >= 1000 && this.room.getStoredEnergy() > 10_000);
		}

		// @todo For level-based recipes, use empire-wide resource capabilities and request via terminal.
		return this.mayCreateCommodities(resourceType, recipe);
	}

	mayCreateCommodities(product: FactoryProductConstant, recipe: Recipe): boolean {
		const createdAmount = this.room.getCurrentResourceAmount(product) / recipe.amount;

		if (this.isMadeOnlyFromBasicResources(recipe)) {
			for (const resourceType in recipe.components) {
				const resourceAmount = this.room.getCurrentResourceAmount(resourceType);
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
			if (this.room.getCurrentResourceAmount(resourceType) < recipe.components[resourceType]) return false;
		}

		return true;
	}
}
