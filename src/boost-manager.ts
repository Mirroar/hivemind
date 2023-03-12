import cache from 'utils/cache';

declare global {
	interface Memory {
		boost: BoostManagerMemory;
	}

	interface StructureLab {
		hasBoostedThisTick?: boolean;
	}
}

type BoostManagerMemory = {
	creeps: Record<string, Partial<Record<ResourceConstant, number>>>
	labs: Record<Id<StructureLab>, ResourceConstant>
}

export default class BoostManager {
	memory: BoostManagerMemory;
	room: Room;

	constructor(room: Room) {
		this.room = room;

		if (!Memory.boost) Memory.boost = {creeps: {}, labs: {}};

		this.memory = Memory.boost;

		this.cleanBoostMemory();
	}

	/**
	 * Removes memory entries for creeps / labs that no longer exist.
	 */
	private cleanBoostMemory() {
		for (const creepName in this.memory.creeps) {
			if (!Game.creeps[creepName]) delete this.memory.creeps[creepName];
		}

		for (const id in this.memory.labs) {
			if (!Game.getObjectById(id)) delete this.memory.labs[id];
		}
	}

	/**
	 * Prepares memory for boosting a new creep.
	 *
	 * @param {string} creepName
	 *   Name of the creep to boost.
	 * @param {object} boosts
	 *   List of resource types to use for boosting, indexed by body part.
	 */
	markForBoosting(creepName: string, boosts: Partial<Record<ResourceConstant, number>>) {
		this.memory.creeps[creepName] = boosts;
	}

	creepNeedsBoosting(creep: Creep) {
		if (this.memory.creeps[creep.name]) return true;

		return false;
	}

	/**
	 * Overrides a creep's default logic while it's being boosted.
	 *
	 * @param {Creep} creep
	 *   The creep to manage.
	 *
	 * @return {boolean}
	 *   True if we're currently overriding the creep's logic.
	 */
	overrideCreepLogic(creep: Creep): boolean {
		if (!this.creepNeedsBoosting(creep)) return false;

		const targetLab = this.getBestLabForBoosting(creep);
		if (!targetLab) {
			// Wait around until labs are ready.
			creep.whenInRange(5, creep.room.controller, () => {});
			return true;
		}

		this.boostCreepAtLab(creep, targetLab);

		return true;
	}

	private getBestLabForBoosting(creep: Creep): StructureLab {
		const neededBoosts = this.memory.creeps[creep.name];

		return this.getMostPreparedLab(neededBoosts);
	}

	private getMostPreparedLab(boosts: Partial<Record<ResourceConstant, number>>): StructureLab {
		this.ensureBoostsHaveLabAssigned(boosts);
		const labs = this.getLabsForBoosts(boosts);

		// @todo This part should be another method.
		let best: StructureLab;
		let bestScore = 0;
		for (const lab of labs) {
			const resourceType = this.memory.labs[lab.id];
			const energyScore = Math.min(lab.store.energy / LAB_BOOST_ENERGY / boosts[resourceType], 1);
			const mineralScore = 3 * Math.min(lab.store.getUsedCapacity(resourceType) / LAB_BOOST_MINERAL / boosts[resourceType], 1);

			if (!best || bestScore < energyScore + mineralScore) {
				best = lab;
				bestScore = energyScore + mineralScore;
			}
		}

		return best;
	}

	private ensureBoostsHaveLabAssigned(boosts: Partial<Record<ResourceConstant, number>>) {
		const roomLabs = this.room.find<StructureLab>(FIND_MY_STRUCTURES, {filter: s => s.structureType === STRUCTURE_LAB && s.isOperational()});

		for (const resourceType in boosts) {
			const assignedLab = _.find(roomLabs, lab => this.memory.labs[lab.id] === resourceType);
			if (assignedLab) continue;

			// @todo This part should be another method.
			let best: StructureLab;
			let bestScore = 0;
			for (const lab of roomLabs) {
				if (lab.id === this.room.memory.labs?.source1) continue;
				if (lab.id === this.room.memory.labs?.source2) continue;
				if (this.memory.labs[lab.id]) continue;

				const fullnessScore = 1 - (((lab.mineralType && lab.mineralType !== resourceType) ? lab.store.getUsedCapacity(lab.mineralType) : 0) / LAB_MINERAL_CAPACITY);
				const energyScore = lab.store.energy / LAB_ENERGY_CAPACITY;

				if (!best || bestScore < fullnessScore + energyScore) {
					best = lab;
					bestScore = fullnessScore + energyScore;
				}
			}
		}
	}

	private getLabsForBoosts(boosts: Partial<Record<ResourceConstant, number>>): StructureLab[] {
		const roomLabs = this.room.find<StructureLab>(FIND_MY_STRUCTURES, {filter: s => s.structureType === STRUCTURE_LAB && s.isOperational()});
		const boostLabs: StructureLab[] = [];
		for (const resourceType in boosts) {
			const assignedLab = _.find(roomLabs, lab => this.memory.labs[lab.id] === resourceType);
			if (assignedLab) boostLabs.push(assignedLab);
		}

		return boostLabs;
	}

	private boostCreepAtLab(creep: Creep, lab: StructureLab) {
		const resourceType = this.memory.labs[lab.id];
		const amount = this.memory.creeps[creep.name][resourceType];

		creep.whenInRange(1, lab, () => {
			if (lab.mineralType !== resourceType) return;
			if (lab.mineralAmount < amount * LAB_BOOST_MINERAL) return;
			if (lab.energy < amount * LAB_BOOST_ENERGY) return;
			if (lab.hasBoostedThisTick) return;

			// @todo When waiting, give way to any other creeps so as to not block them.

			// If there is enough energy and resources, boost!
			if (lab.boostCreep(creep) === OK) {
				// Prevent trying to boost another creep with this lab during this tick.
				lab.hasBoostedThisTick = true;

				// Awesome, boost has been applied (in theory).
				// Clear memory, to prevent trying to boost again.
				delete this.memory.creeps[creep.name][resourceType];
				if (_.keys(this.memory.creeps[creep.name]).length === 0)
					delete this.memory.creeps[creep.name];

				// Unassign lab if no longer needed for boosting.
				this.ensureLabIsStillNeededForBoosting(lab);
			}
		});
	}

	private ensureLabIsStillNeededForBoosting(lab: StructureLab) {
		const resourceType = this.memory.labs[lab.id];
		const needsThisBoost = _.find(this.memory.creeps, (boosts, creepName) => boosts[resourceType] && Game.creeps[creepName]?.pos?.roomName === this.room.name);

		if (!needsThisBoost) delete this.memory.labs[lab.id];
	}
}
