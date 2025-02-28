import hivemind from 'hivemind';
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
				if (this.room.isEvacuating() && resourceType !== RESOURCE_ENERGY) continue;

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
		const maxRawMaterialRatio = 1;

		const storedEnergy = this.room.getStoredEnergy() + this.room.factory.store.getUsedCapacity(RESOURCE_ENERGY);
		const storedProduct = this.room.getCurrentResourceAmount(resourceType) + this.room.factory.store.getUsedCapacity(resourceType);
		const storedResource = this.room.getCurrentResourceAmount(uncompressRecipes[resourceType] || compressRecipes[resourceType]) + this.room.factory.store.getUsedCapacity(uncompressRecipes[resourceType] || compressRecipes[resourceType]);

		if (resourceType === RESOURCE_BATTERY) {
			// We want to compress energy when we have a lot of it, and need more storage space.
			// @todo Also compress when we need to send it long distances.
			const rawMaterialRatio = storedResource / Math.max(storedProduct + storedResource, 1);
			const minProduct = hivemind.settings.get('enableDepositMining') ? 500 : 0;
			return (
					storedProduct < minProduct
					|| storageFull
					|| rawMaterialRatio > maxRawMaterialRatio
				)
				&& storedEnergy > 15_000;
		}

		if (resourceType === RESOURCE_ENERGY) {
			// We want to uncompress energy when we have the space and need for it.
			const rawMaterialRatio = storedProduct / Math.max(storedProduct + storedResource, 1);
			return (
					storedProduct < 10_000
					// || storageEmpty
					|| rawMaterialRatio < minRawMaterialRatio
				)
				&& storedResource > 100;
		}

		const isCompressingRecipe = !!uncompressRecipes[resourceType];
		if (isCompressingRecipe) {
			// resourceType is compressed, e.g. a bar. Thus the recipe is one for compressing.
			// storedProduct is the amount of compressed resource.
			// storedResource is the amount of raw resource.
			// We want to compress when we need it for commodities, or when we need more storage space.
			// @todo Also compress when we need to send it long distances.
			const rawMaterialRatio = storedResource / Math.max(storedProduct + storedResource, 1);
			const minProduct = hivemind.settings.get('enableDepositMining') ? 500 : 0;
			return (
					storedProduct < minProduct 
					|| storageFull 
					|| rawMaterialRatio > maxRawMaterialRatio
				)
				&& storedResource > 5000
				&& storedEnergy > 5000;
		}

		const isUncompressingRecipe = !!compressRecipes[resourceType];
		if (isUncompressingRecipe) {
			// resourceType is uncomplessed, e.g. a mineral. Thus the recipe is one for uncompressing.
			// storedProduct is the amount of raw resource.
			// storedResource is the amount of compressed resource.
			// We want to uncompress when we have a lot of the compressed resource, and storage space.
			const rawMaterialRatio = storedProduct / Math.max(storedProduct + storedResource, 1);
			return (
					storedProduct < 2000 
					// || storageEmpty
					|| rawMaterialRatio < minRawMaterialRatio
				)
				&& storedResource > 100
				&& storedEnergy > 5000;
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
