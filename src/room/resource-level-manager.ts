import container from 'utils/container';
import {ENEMY_STRENGTH_NORMAL} from "room-defense";

export type ResourceLevel = 'low' | 'medium' | 'high' | 'excessive';
export type ResourceLevelCuttoffs = [number, number, number];

const depositResourceTypes: string[] = [
	RESOURCE_SILICON,
	RESOURCE_METAL,
	RESOURCE_BIOMASS,
	RESOURCE_MIST,
];
const commodityResourceTypes: string[] = [
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

export default class ResourceLevelManager {
	determineResourceLevel(room: Room, amount: number, resourceType: ResourceConstant): ResourceLevel {
		const cutoffs = this.getResourceLevelCutoffs(room, resourceType);
		if (amount >= cutoffs[0]) return 'excessive';
		if (amount >= cutoffs[1]) return 'high';
		if (amount >= cutoffs[2]) return 'medium';
		return 'low';
	};

	getResourceLevelCutoffs(room: Room, resourceType: ResourceConstant): ResourceLevelCuttoffs {
		// @todo If the room has a factory, consolidate normal resources and bars.
	
		if (resourceType === RESOURCE_ENERGY) {
			return this.getEnergyCutoffs(room);
		}

		if (resourceType === RESOURCE_POWER) {
			return this.getPowerCutoffs(room);
		}

		if (resourceType === RESOURCE_OPS) {
			return this.getOpsCutoffs(room);
		}

		if (this.isDepositResource(resourceType)) {
			return this.getDepositCutoffs(room);
		}

		if (this.isCommodityResource(resourceType)) {
			return this.getCommodityCutoffs(room, resourceType);
		}

		if (this.isBoostResource(resourceType)) {
			return this.getBoostCutoffs(room, resourceType);
		}

		if (this.isReactionResource(room, resourceType)) {
			return this.getReactionCutoffs(room, resourceType);
		}

		// Any other resources, we can store but don't need.
		return [50_000, 0, 0];
	}

	private getEnergyCutoffs(room: Room): ResourceLevelCuttoffs {
		if (room.defense.getEnemyStrength() >= ENEMY_STRENGTH_NORMAL) {
			// Defending rooms need energy to defend.
			return [1_000_000, 100_000, 50_000];
		}

		const funnelManager = container.get('FunnelManager');
		if (funnelManager.isFunnelingTo(room.name)) {
			// Rooms we are funneling should pull extra energy.
			return [500_000, 300_000, 150_000];
		}

		return [200_000, 50_000, 20_000];
	}

	private getPowerCutoffs(room: Room): ResourceLevelCuttoffs {
		if (!room.powerSpawn) {
			return [1, 0, 0];
		}

		return [50_000, 30_000, 10_000];
	}

	private getOpsCutoffs(room: Room): ResourceLevelCuttoffs {
		if (_.filter(Game.powerCreeps, c => c.pos?.roomName === room.name).length === 0) {
			return [1, 0, 0];
		}

		return [10_000, 5000, 1000];
	}

	private isDepositResource(resourceType: ResourceConstant): boolean {
		return depositResourceTypes.includes(resourceType);
	}

	private getDepositCutoffs(room: Room): ResourceLevelCuttoffs {
		// Basic commodities need any kind of factory.
		if (!room.factory) {
			return [1, 0, 0];
		}

		return [30_000, 10_000, 2000];
	}

	private isCommodityResource(resourceType: ResourceConstant): boolean {
		return commodityResourceTypes.includes(resourceType);
	}

	private getCommodityCutoffs(room: Room, resourceType: ResourceConstant): ResourceLevelCuttoffs {
		// Higher level commodities need a factory of appropriate level to be used.
		if (!room.factory) {
			return [1, 0, 0];
		}

		if (!this.isCommodityNeededAtFactoryLevel(room.factory.getEffectiveLevel(), resourceType)) {
			return [1, 0, 0];
		}

		return [10_000, 5000, 500];
	}

	private isCommodityNeededAtFactoryLevel(factoryLevel: number, resourceType: ResourceConstant): boolean {
		for (const productType in COMMODITIES) {
			const recipe = COMMODITIES[productType];
			if (recipe.level && recipe.level !== factoryLevel) continue;
			if (recipe.components[resourceType]) return true;
		}

		return false;
	}

	private isBoostResource(resourceType: ResourceConstant): boolean {
		for (const bodyPart in BOOSTS) {
			if (!BOOSTS[bodyPart][resourceType]) continue;

			return true;
		}

		return false;
	}

	private getBoostCutoffs(room: Room, resourceType: ResourceConstant): ResourceLevelCuttoffs {
		// @todo If there's no labs, we don't need boosts.

		for (const bodyPart in BOOSTS) {
			if (!BOOSTS[bodyPart][resourceType]) continue;

			if ((bodyPart === ATTACK || bodyPart === RANGED_ATTACK) && room.defense.getEnemyStrength() > ENEMY_STRENGTH_NORMAL) {
				return [15_000, 7500, 2500];
			}

			if (bodyPart === WORK && BOOSTS[bodyPart][resourceType].repair && room.defense.getEnemyStrength() > ENEMY_STRENGTH_NORMAL) {
				return [15_000, 7500, 2500];
			}

			if (bodyPart === WORK && BOOSTS[bodyPart][resourceType].upgradeController && room.controller.level >= 8) {
				return [15_000, 7500, 2500];
			}
		}

		return [50_000, 0, 0];
	}

	private isReactionResource(room: Room, resourceType: ResourceConstant): boolean {
		const reaction = room.memory.currentReaction;
		if (reaction && (resourceType === reaction[0] || resourceType === reaction[1])) {
			return true;
		}
		
		return false;
	}

	private getReactionCutoffs(room: Room, resourceType: ResourceConstant): ResourceLevelCuttoffs {
		return [50_000, 30_000, 10_000];
	}

}