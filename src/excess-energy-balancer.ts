import hivemind from './hivemind';

declare global {
  interface Memory {
    energyBalace?: {
      gplEnergy: number;
      powerEnergy: number;
    };
  }
}

export default class ExcessEnergyBalancer {
  constructor() {
    if (!Memory.energyBalace) {
      Memory.energyBalace = {
        gplEnergy: 0,
        powerEnergy: 0,
      };
    }
  }

  getRatio(): number {
    return hivemind.settings.get<number>('powerProcessingEnergyRatio');
  }

  recordGplEnergy(amount: number) {
    Memory.energyBalace.gplEnergy += amount;
  }

  recordPowerEnergy(amount: number) {
    Memory.energyBalace.powerEnergy += amount;
  }

  maySpendEnergyOnGpl(): boolean {
    return true;
  }

  maySpendEnergyOnPowerProcessing(): boolean {
    return true;
  }
}
