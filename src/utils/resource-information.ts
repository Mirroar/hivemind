import cache from "utils/cache";
import container from "utils/container";
import { getResourcesIn } from "utils/store";

export const depositResourceTypes: ResourceConstant[] = [
    RESOURCE_SILICON,
    RESOURCE_METAL,
    RESOURCE_BIOMASS,
    RESOURCE_MIST,
];
export const commodityResourceTypes: ResourceConstant[] = [
    RESOURCE_COMPOSITE,
    RESOURCE_CRYSTAL,
    RESOURCE_LIQUID,
    RESOURCE_WIRE,
    RESOURCE_SWITCH,
    RESOURCE_TRANSISTOR,
    RESOURCE_MICROCHIP,
    RESOURCE_CIRCUIT,
    RESOURCE_DEVICE,
    RESOURCE_CELL,
    RESOURCE_PHLEGM,
    RESOURCE_TISSUE,
    RESOURCE_MUSCLE,
    RESOURCE_ORGANOID,
    RESOURCE_ORGANISM,
    RESOURCE_ALLOY,
    RESOURCE_TUBE,
    RESOURCE_FIXTURES,
    RESOURCE_FRAME,
    RESOURCE_HYDRAULICS,
    RESOURCE_MACHINE,
    RESOURCE_CONDENSATE,
    RESOURCE_CONCENTRATE,
    RESOURCE_EXTRACT,
    RESOURCE_SPIRIT,
    RESOURCE_EMANATION,
    RESOURCE_ESSENCE,
];

export default class ResourceInformation {

	public isDepositResource(resourceType: ResourceConstant): boolean {
		return depositResourceTypes.includes(resourceType);
	}

	public isCommodityResource(resourceType: ResourceConstant): boolean {
		return commodityResourceTypes.includes(resourceType);
	}

    public isCommodityNeededAtFactoryLevel(factoryLevel: number, resourceType: ResourceConstant): boolean {
        const upgradeLevels = this.getCommodityUpgradeLevels();
        if (upgradeLevels[resourceType]) {
            return upgradeLevels[resourceType].includes(factoryLevel);
        }

        return false;
    }

	public getCommodityUpgradeLevels() {
		return cache.inHeap('commodity-upgrade-levels', 100_000, () => {
			const levels: Partial<Record<CommoditiesTypes, number[]>> = {};
			const resourceInformation = container.get('ResourceInformation');

			for (const [, commodity] of Object.entries(COMMODITIES)) {
				if (!commodity.level) continue;

				for (const component of getResourcesIn(commodity.components)) {
					if (!resourceInformation.isCommodityResource(component)) continue;
					if (!levels[component]) levels[component] = [];
					if (!levels[component].includes(commodity.level)) levels[component].push(commodity.level);
				}
			}

			return levels;
		});
	}

    public isBoostResource(resourceType: ResourceConstant): boolean {
        for (const bodyPart in BOOSTS) {
            if (!BOOSTS[bodyPart][resourceType]) continue;

            return true;
        }

        return false;
    }
}
