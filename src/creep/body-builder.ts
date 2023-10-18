const MOVEMENT_TYPE_ROAD = 0;
const MOVEMENT_TYPE_PLAINS = 1;
const MOVEMENT_TYPE_SWAMP = 2;

type MovementMode = typeof MOVEMENT_TYPE_ROAD | typeof MOVEMENT_TYPE_PLAINS | typeof MOVEMENT_TYPE_SWAMP;
type BodyWeights = Partial<Record<BodyPartConstant, number>>;
type PartCounts = Partial<Record<BodyPartConstant, number>>;

export {
	MOVEMENT_TYPE_ROAD,
	MOVEMENT_TYPE_PLAINS,
	MOVEMENT_TYPE_SWAMP,
}

export default class BodyBuilder {
	moveMode: MovementMode;
	maxSize: number;
	energyLimit?: number;
	weights: BodyWeights;

	public constructor() {
		this.moveMode = MOVEMENT_TYPE_PLAINS;
		this.maxSize = MAX_CREEP_SIZE;
		this.energyLimit = null;
		this.weights = {};
	}

	public setMovementMode(mode: MovementMode): self {
		this.moveMode = mode;
		return this;
	}

	public setMaxSize(size?: number): self {
		this.maxSize = size ?? MAX_CREEP_SIZE;
		return this;
	}

	public setEnergyLimit(limit?: number): self {
		this.energyLimit = limit;
		return this;
	}

	public setBodyWeights(weights: BodyWeights): self {
		this.weights = this.normalizeWeights(weights);
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

		if (currentSize > this.maxSize) return {};
		if (this.energyLimit && currentCost > this.energyLimit) return {};

		while (currentSize < this.maxSize) {
			const nextPart = this.getNextBodyPart(partCounts);
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
		for (const partType in this.weights) {
			if ((currentWeights[partType] || 0) < this.weights[partType]) return partType;
			if (!fallbackPart) fallbackPart = partType;
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
		for (const part in partCounts) {
			total += partCounts[part] * this.getGeneratedFatigue(part);
		}

		return total;
	}

	private getGeneratedFatigue(part: BodyPartConstant) {
		if (part === MOVE) return 0;

		// @todo There might be cases where it makes sense to treat
		// CARRY parts as empty most of the time.

		if (this.moveMode === MOVEMENT_TYPE_ROAD) return 1;
		if (this.moveMode === MOVEMENT_TYPE_PLAINS) return 2;
		if (this.moveMode === MOVEMENT_TYPE_SWAMP) return 10;
	}

	private getMovePartStrength(): number {
		// @todo Adjust to implement move part boosting.
		return 2;
	}

	private generateSortedParts(partCounts: Partial<Record<BodyPartConstant, number>>): BodyPartConstant[] {
		// @todo
		// Interweave carry and move parts
		// Have move parts in the middle for military creeps, else at the end

		return this.interweaveMoveParts(body, partCounts[MOVE]);
	}

	private interweaveMoveParts(body: BodyPartConstant[]): BodyPartConstant[] {
		// @todo
	}
}
