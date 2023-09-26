import settings from './settings-manager';

declare global {
	interface Memory {
		energyBalace?: {
			gplEnergy: number;
			powerEnergy: number;
		};
	}
}

const balancer = {
	init() {
		if (!Memory.energyBalace) {
			Memory.energyBalace = {
				gplEnergy: 0,
				powerEnergy: 0,
			};
		}
	},

	getRatio(): number {
		if (!settings.get('constructPowerSpawns')) return 0;
		return settings.get('powerProcessingEnergyRatio');
	},

	recordGplEnergy(amount: number) {
		Memory.energyBalace.gplEnergy += amount;

		this.balanceEnergyLevels();
	},

	recordPowerEnergy(amount: number) {
		Memory.energyBalace.powerEnergy += amount;

		this.balanceEnergyLevels();
	},

	balanceEnergyLevels() {
		const ratio = this.getRatio();
		if (ratio >= 1 || ratio <= 0) {
			// There's nothing to balance, all energy goes into one category.
			Memory.energyBalace.gplEnergy = 0;
			Memory.energyBalace.powerEnergy = 0;
			return;
		}

		if (Memory.energyBalace.gplEnergy === 0 || Memory.energyBalace.powerEnergy === 0) return;

		const currentRatio = Memory.energyBalace.powerEnergy / Memory.energyBalace.gplEnergy;

		if (currentRatio > ratio) {
			// We spent more energy on power than planned.
			Memory.energyBalace.powerEnergy -= Memory.energyBalace.gplEnergy * ratio / (1 - ratio);
			Memory.energyBalace.gplEnergy = 0;
		}
		else {
			// We spent more energy on GPL than planned.
			Memory.energyBalace.gplEnergy -= Memory.energyBalace.powerEnergy * (1 - ratio) / ratio;
			Memory.energyBalace.powerEnergy = 0;
		}
	},

	maySpendEnergyOnGpl(): boolean {
		if (!settings.get('constructPowerSpawns')) return true;

		const ratio = 1 - this.getRatio();

		return ratio >= 1 || Memory.energyBalace.gplEnergy < 10_000;
	},

	maySpendEnergyOnPowerProcessing(): boolean {
		if (!settings.get('constructPowerSpawns')) return false;
		const ratio = this.getRatio();

		return ratio >= 1 || Memory.energyBalace.powerEnergy < 10_000;
	},
};

export default balancer;
