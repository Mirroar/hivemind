const MOVEMENT_MODE_ROAD = 0;
const MOVEMENT_MODE_PLAINS = 1;
const MOVEMENT_MODE_SWAMP = 2;
const MOVEMENT_MODE_SLOW = 3;
const MOVEMENT_MODE_MINIMAL = 4;
const MOVEMENT_MODE_NONE = 5;

type MovementMode = typeof MOVEMENT_MODE_ROAD
	| typeof MOVEMENT_MODE_PLAINS
	| typeof MOVEMENT_MODE_SWAMP
	| typeof MOVEMENT_MODE_SLOW
	| typeof MOVEMENT_MODE_MINIMAL
	| typeof MOVEMENT_MODE_NONE;
type BodyWeights = Partial<Record<BodyPartConstant, number>>;
type PartCounts = Partial<Record<BodyPartConstant, number>>;

declare global {
	namespace NodeJS {
		interface Global {
			BodyBuilder: typeof BodyBuilder;
		}
	}
}

export {
	MOVEMENT_MODE_ROAD,
	MOVEMENT_MODE_PLAINS,
	MOVEMENT_MODE_SWAMP,
	MOVEMENT_MODE_SLOW,
	MOVEMENT_MODE_MINIMAL,
	MOVEMENT_MODE_NONE,
}

export default class BodyBuilder {
	moveMode: MovementMode;
	maxSize: number;
	energyLimit?: number;
	weights: BodyWeights;
	partLimits: PartCounts;
	moveBufferRatio: number;
	carryContentLevel: number;

	public constructor() {
		this.moveMode = MOVEMENT_MODE_PLAINS;
		this.maxSize = MAX_CREEP_SIZE;
		this.energyLimit = null;
		this.weights = {};
		this.partLimits = {};
		this.moveBufferRatio = 0;
		this.carryContentLevel = 1;
	}

	public setMovementMode(mode: MovementMode): this {
		this.moveMode = mode;
		return this;
	}

	public setMaxSize(size?: number): this {
		this.maxSize = size ?? MAX_CREEP_SIZE;
		return this;
	}

	public setEnergyLimit(limit?: number): this {
		this.energyLimit = limit;
		return this;
	}

	public setWeights(weights: BodyWeights): this {
		this.weights = this.normalizeWeights(weights);
		return this;
	}

	public setPartLimit(partType: BodyPartConstant, limit: number): this {
		this.partLimits[partType] = limit;
		return this;
	}

	public setMoveBufferRatio(ratio: number) {
		this.moveBufferRatio = ratio;
		return this;
	}

	public setCarryContentLevel(level: number) {
		this.carryContentLevel = level;
		return this;
	}

	private normalizeWeights(weights: BodyWeights): BodyWeights {
		const total = _.sum(_.filter(weights, (weight, partType) => weight > 0 && partType !== MOVE));

		if (total <= 0) return {};

		const result: BodyWeights = {};
		for (const partType in weights) {
			if (partType === MOVE) continue;
			if (weights[partType] <= 0) continue;

			result[partType] = weights[partType] / total;
		}

		return result;
	}

	public build(): BodyPartConstant[] {
		const partCounts = this.calculatePartCounts();
		const sortedParts = this.generateSortedParts(partCounts);

		return sortedParts;
	}

	private calculatePartCounts(): PartCounts {
		const partCounts: PartCounts = {[MOVE]: 0};
		let currentSize = 0;
		let currentCost = 0;

		for (const partType in this.weights) {
			partCounts[partType] = 1;
			currentSize++;
			currentCost += BODYPART_COST[partType];
		}

		partCounts[MOVE] = Math.ceil(this.getTotalGeneratedFatigue(partCounts, MOVE) / this.getMovePartStrength());
		currentSize += partCounts[MOVE];
		currentCost += partCounts[MOVE] * BODYPART_COST[MOVE];

		if (currentSize > this.maxSize) return {};
		if (this.energyLimit && currentCost > this.energyLimit) return {};

		while (currentSize < this.maxSize) {
			const nextPart = this.getNextBodyPart(partCounts);
			if (this.partLimits[nextPart] && partCounts[nextPart] >= this.partLimits[nextPart]) break;

			const neededMoves = this.getNextMovePartIncrement(partCounts, nextPart);

			const partCost = BODYPART_COST[nextPart] + neededMoves * BODYPART_COST[MOVE];
			if (this.energyLimit && currentCost + partCost > this.energyLimit) break;
			if (currentSize + neededMoves + 1 > this.maxSize) break;

			partCounts[nextPart] = (partCounts[nextPart] ?? 0) + 1;
			partCounts[MOVE] += neededMoves;
			currentSize += 1 + neededMoves;
			currentCost += partCost;
		}

		return partCounts;
	}

	private getNextBodyPart(partCounts: PartCounts): BodyPartConstant {
		const currentWeights = this.normalizeWeights(partCounts);

		let fallbackPart: BodyPartConstant = null;
		for (const part of (_.keys(this.weights) as BodyPartConstant[])) {
			if ((currentWeights[part] || 0) < this.weights[part]) return part;
			if (!fallbackPart) fallbackPart = part;
		}

		return fallbackPart;
	}

	private getNextMovePartIncrement(partCounts: PartCounts, nextPart: BodyPartConstant): number {
		const fatigue = this.getTotalGeneratedFatigue(partCounts, nextPart);
		const neededMoves = Math.ceil(fatigue / this.getMovePartStrength());

		return neededMoves - (partCounts[MOVE] ?? 0);
	}

	private getTotalGeneratedFatigue(partCounts: PartCounts, nextPart: BodyPartConstant): number {
		let total = this.getGeneratedFatigue(nextPart);
		for (const part of (_.keys(partCounts) as BodyPartConstant[])) {
			total += partCounts[part] * this.getGeneratedFatigue(part);
		}

		return total;
	}

	private getGeneratedFatigue(part: BodyPartConstant) {
		if (part === MOVE) return 0;

		// There might be cases where it makes sense to treat
		// CARRY parts as empty most of the time.
		const multiplier = (part === CARRY ? this.carryContentLevel : 1);

		switch (this.moveMode) {
			case MOVEMENT_MODE_SWAMP:
				return 10 * multiplier;
			case MOVEMENT_MODE_PLAINS:
				return 2 * multiplier;
			case MOVEMENT_MODE_ROAD:
				return 1 * multiplier;
			case MOVEMENT_MODE_SLOW:
				return 2 / 5 * multiplier;
			case MOVEMENT_MODE_MINIMAL:
				return 0.001 * multiplier;
			case MOVEMENT_MODE_NONE:
				return 0;
			default:
				const exhaustiveCheck: never = this.moveMode;
				throw 'Invalid movement mode given.';
		}

	}

	private getMovePartStrength(): number {
		// @todo Adjust to implement move part boosting.
		return 2;
	}

	private generateSortedParts(partCounts: Partial<Record<BodyPartConstant, number>>): BodyPartConstant[] {
		// @todo Create array of non-move parts in sensible order.
		const body: BodyPartConstant[] = [];

		// Start with tough parts.
		// @todo Reevaluate this when including tough boosts.
		while ((partCounts[TOUGH] || 0) > 0) {
			body.push(TOUGH);
			partCounts[TOUGH]--;
		}

		// Add non-military parts.
		let done = false;
		while (!done) {
			done = true;
			for (const part of (_.keys(partCounts) as BodyPartConstant[])) {
				if (part === ATTACK || part === RANGED_ATTACK || part === HEAL || part === MOVE) continue;
				if (partCounts[part] > 0) {
					body.push(part);
					partCounts[part]--;
					done = false;
				}
			}
		}

		// Add military parts last to keep fighting effeciency.
		const lastParts = [RANGED_ATTACK, ATTACK, HEAL];
		for (const part of lastParts) {
			for (let i = 0; i < partCounts[part] || 0; i++) {
				body.push(part);
			}
		}

		return this.interweaveMoveParts(body, partCounts[MOVE]);
	}

	private interweaveMoveParts(body: BodyPartConstant[], moveParts: number): BodyPartConstant[] {
		const moveStrength = this.getMovePartStrength();
		let totalFatigue = _.sum(body, part => this.getGeneratedFatigue(part));
		let totalMovePower = moveParts * moveStrength;

		const newBody: BodyPartConstant[] = [];
		let functionalPartCount = 0;
		for (const part of body) {
			console.log(totalFatigue, totalMovePower);

			while (totalMovePower - totalFatigue >= moveStrength) {
				newBody.push(MOVE);
				totalMovePower -= moveStrength;
			}

			if (1 - (functionalPartCount / body.length) <= this.moveBufferRatio) {
				// Add all remaining move parts to act as armor before other
				// parts get damaged.
				while (totalMovePower > 0) {
					newBody.push(MOVE);
					totalMovePower -= moveStrength;
				}
			}

			newBody.push(part);
			functionalPartCount++;

			// Empty carry parts no longer generate fatigue.
			if (part === CARRY) totalFatigue -= this.getGeneratedFatigue(part);
		}

		while (totalMovePower > 0) {
			newBody.push(MOVE);
			totalMovePower -= moveStrength;
		}

		return newBody;
	}
}

global.BodyBuilder = BodyBuilder;
