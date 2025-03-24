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
		const applicableCutoffs: ResourceLevelCuttoffs[] = [];
		if (resourceType === RESOURCE_ENERGY) {
			applicableCutoffs.push(this.getEnergyCutoffs(room));
		}

		if (resourceType === RESOURCE_POWER) {
			applicableCutoffs.push(this.getPowerCutoffs(room));
		}

		if (resourceType === RESOURCE_OPS) {
			applicableCutoffs.push(this.getOpsCutoffs(room));
		}

		if (this.isDepositResource(resourceType)) {
			applicableCutoffs.push(this.getDepositCutoffs(room));
		}

		if (this.isCommodityResource(resourceType)) {
			applicableCutoffs.push(this.getCommodityCutoffs(room, resourceType));
		}

		if (this.isBoostResource(resourceType)) {
			applicableCutoffs.push(this.getBoostCutoffs(room, resourceType));
		}

		if (this.isReactionResource(room, resourceType)) {
			applicableCutoffs.push(this.getReactionCutoffs(room, resourceType));
		}

		// Any other resources, we can store but don't need.
		if (applicableCutoffs.length === 0) {
			applicableCutoffs.push([50_000, 0, 0]);
		}

		if (Game.shard.name === 'shardSeason' && resourceType === RESOURCE_SCORE) {
			if (_.some(Game.flags, flag => flag.name === 'score:' + room.name)) {
				applicableCutoffs.push([100_000, 50_000, 20_000]);
			}
		}

		return applicableCutoffs.reduce((acc, cutoffs) => {
			return [
				Math.max(acc[0], cutoffs[0]),
				Math.max(acc[1], cutoffs[1]),
				Math.max(acc[2], cutoffs[2]),
			];
		});
	}

	private getEnergyCutoffs(room: Room): ResourceLevelCuttoffs {
		if (room.defense.getEnemyStrength() >= ENEMY_STRENGTH_NORMAL) {
			// Defending rooms need energy to defend.
			// @todo But only if we have a chance of winning.
			return [200_000, 100_000, 50_000];
		}

		if (room.defense.isAnyRoomUnderAttack()) {
			// Rooms that are not under attack should give extra energy to rooms that are.
			return [50_000, 20_000, 15_000];
		}

		const funnelManager = container.get('FunnelManager');
		if (funnelManager.isFunnelingTo(room.name)) {
			// Rooms we are funneling should pull extra energy.
			return [500_000, 300_000, 150_000];
		}

		if ((room.myStructuresByType[STRUCTURE_POWER_SPAWN] || []).length > 0) {
			// Power processing rooms need a lot of energy.
			return [200_000, 100_000, 50_000];
		}

		return [200_000, 50_000, 20_000];
	}

	private getPowerCutoffs(room: Room): ResourceLevelCuttoffs {
		if (!room.powerSpawn || room.defense.getEnemyStrength() > ENEMY_STRENGTH_NORMAL) {
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

	public isDepositResource(resourceType: ResourceConstant): boolean {
		return depositResourceTypes.includes(resourceType);
	}

	private getDepositCutoffs(room: Room): ResourceLevelCuttoffs {
		// Basic commodities need any kind of factory.
		if (!room.factory || room.defense.getEnemyStrength() > ENEMY_STRENGTH_NORMAL) {
			return [1, 0, 0];
		}

		return [30_000, 10_000, 2000];
	}

	public isCommodityResource(resourceType: ResourceConstant): boolean {
		return commodityResourceTypes.includes(resourceType);
	}

	private getCommodityCutoffs(room: Room, resourceType: ResourceConstant): ResourceLevelCuttoffs {
		// Higher level commodities need a factory of appropriate level to be used.
		if (!room.factory || room.defense.getEnemyStrength() > ENEMY_STRENGTH_NORMAL) {
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

	public isBoostResource(resourceType: ResourceConstant): boolean {
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

			if (bodyPart === WORK && BOOSTS[bodyPart][resourceType].upgradeController && room.controller.level >= 8) {
				return [15_000, 7500, 2500];
			}

			if (room.defense.getEnemyStrength() <= ENEMY_STRENGTH_NORMAL) continue;

			if ((bodyPart === ATTACK || bodyPart === RANGED_ATTACK)) {
				return [15_000, 7500, 2500];
			}

			if (bodyPart === WORK && BOOSTS[bodyPart][resourceType].repair) {
				return [15_000, 7500, 2500];
			}
		}

		if (room.defense.getEnemyStrength() > ENEMY_STRENGTH_NORMAL) return [1, 0, 0];

		return [15_000, 0, 0];
	}

	private isReactionResource(room: Room, resourceType: ResourceConstant): boolean {
		const reaction = room.memory.currentReaction;
		if (reaction && (resourceType === reaction[0] || resourceType === reaction[1])) {
			return true;
		}
		
		return false;
	}

	private getReactionCutoffs(room: Room, resourceType: ResourceConstant): ResourceLevelCuttoffs {
		if (room.defense.getEnemyStrength() > ENEMY_STRENGTH_NORMAL) return [1, 0, 0];

		return [30_000, 20_000, 10_000];
	}

}