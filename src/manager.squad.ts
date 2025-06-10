import cache from 'utils/cache';

declare global {
	interface CreepMemory {
		squadName?: string;
	}

	interface Memory {
		squads: Record<string, SquadMemory>;
	}

	interface SquadMemory {}
}

export interface Squad {
	getName(): string;
	addUnit(unitType: SquadUnitType): number;
	removeUnit(unitType: SquadUnitType): number;
	setUnitCount(unitType: SquadUnitType, count: number): void;
	getUnitCount(unitType: SquadUnitType): number;
	getComposition(): Partial<Record<SquadUnitType, number>>;
	clearUnits(): void;
	disband(): void;
	getOrders(): Array<{priority: number, weight: number, target: string}>;
	setSpawn(roomName: string): void;
	getSpawn(): string;
	setTarget(targetPos: RoomPosition): void;
	getTarget(): RoomPosition | null;
}

export default class SquadManager {
	squadClass: {new (squadName: string): Squad};

	constructor(squadConstructor: {new (squadName: string): Squad}) {
		this.squadClass = squadConstructor;
	}

	getAllSquads(): Record<string, Squad> {
		return cache.inObject(Game, 'squads', 1, () => {
			const squads = {};
			for (const squadName in Memory.squads) {
				squads[squadName] = new this.squadClass(squadName);
			}

			return squads;
		});
	}

	getSquad(squadName: string): Squad | null {
		return this.getAllSquads()[squadName] || null;
	}

	createSquad(squadName: string): Squad {
		if (this.getSquad(squadName)) {
			throw new Error(`Squad ${squadName} already exists.`);
		}

		const squad = new this.squadClass(squadName);
		return squad;
	}

	getOrCreateSquad(squadName: string): Squad {
		const squad = this.getSquad(squadName);
		if (squad) {
			return squad;
		}

		return this.createSquad(squadName);
	}
}
