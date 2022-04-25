/* global PowerCreep POWER_CREEP_MAX_LEVEL POWER_CLASS POWER_INFO
PWR_OPERATE_FACTORY */

import Process from 'process/process';
import cache from 'utils/cache';
import hivemind from 'hivemind';

const powerNames = {
	[PWR_DISRUPT_SOURCE]: 'PWR_DISRUPT_SOURCE',
	[PWR_DISRUPT_SPAWN]: 'PWR_DISRUPT_SPAWN',
	[PWR_DISRUPT_TERMINAL]: 'PWR_DISRUPT_TERMINAL',
	[PWR_DISRUPT_TOWER]: 'PWR_DISRUPT_TOWER',
	[PWR_FORTIFY]: 'PWR_FORTIFY',
	[PWR_GENERATE_OPS]: 'PWR_GENERATE_OPS',
	[PWR_OPERATE_CONTROLLER]: 'PWR_OPERATE_CONTROLLER',
	[PWR_OPERATE_EXTENSION]: 'PWR_OPERATE_EXTENSION',
	[PWR_OPERATE_FACTORY]: 'PWR_OPERATE_FACTORY',
	[PWR_OPERATE_LAB]: 'PWR_OPERATE_LAB',
	[PWR_OPERATE_OBSERVER]: 'PWR_OPERATE_OBSERVER',
	[PWR_OPERATE_POWER]: 'PWR_OPERATE_POWER',
	[PWR_OPERATE_SPAWN]: 'PWR_OPERATE_SPAWN',
	[PWR_OPERATE_STORAGE]: 'PWR_OPERATE_STORAGE',
	[PWR_OPERATE_TERMINAL]: 'PWR_OPERATE_TERMINAL',
	[PWR_OPERATE_TOWER]: 'PWR_OPERATE_TOWER',
	[PWR_REGEN_MINERAL]: 'PWR_REGEN_MINERAL',
	[PWR_REGEN_SOURCE]: 'PWR_REGEN_SOURCE',
	[PWR_SHIELD]: 'PWR_SHIELD',
};

export default class ManagePowerCreepsProcess extends Process {
	/**
	 * Upgrade power creeps depending on our needs.
	 */
	run() {
		if (!hivemind.settings.get('automaticallyUpgradePowerCreeps')) return;

		const usedGpl = _.sum(_.map(Game.powerCreeps, creep => creep.level + 1));
		if (usedGpl >= Game.gpl.level) return;

		hivemind.log('creeps').info('Unused power creep levels:', Game.gpl.level - usedGpl);

		const creepToUpgrade = _.min(this.getUpgradeablePowerCreeps(), creep => creep.level);
		if (typeof creepToUpgrade !== 'undefined' && typeof creepToUpgrade !== 'number') {
			this.upgradePowerCreep(creepToUpgrade);
		}
		else if (Game.gpl.level - usedGpl > 1) {
			// Create a power creep if we can assign at least one power.
			this.createNewPowerCreep();
		}
	}

	getUpgradeablePowerCreeps(): PowerCreep[] {
		return _.filter(Game.powerCreeps, (creepToUpgrade: PowerCreep) => {
			const currentLevels = this.getFactoryLevelDistribution();
			const currentFactoryLevel = (creepToUpgrade.powers[PWR_OPERATE_FACTORY] || {}).level || 0;
			const skipForFactory =
				hivemind.settings.get('prioritizeFactoryLevels') &&
				!currentLevels[POWER_INFO[PWR_OPERATE_FACTORY].level.length] &&
				currentFactoryLevel === this.getDesiredFactoryLevel(creepToUpgrade);
			if (skipForFactory) {
				return false;
			}

			const smallPCLevel = hivemind.settings.get('operatorEachRoom');
			const skipForNewCreep = smallPCLevel && creepToUpgrade.level >= smallPCLevel;
			if (skipForNewCreep) return false;

			if (creepToUpgrade.level >= POWER_CREEP_MAX_LEVEL) return false;

			return true;
		});
	}

	upgradePowerCreep(creep: PowerCreep) {
		for (const powerOption of hivemind.settings.get('powerPriorities')) {
			// Check if this power could be upgraded.
			const info = POWER_INFO[powerOption];
			const currentLevel = (creep.powers[powerOption] || {}).level || 0;
			if (currentLevel >= info.level.length) continue;

			const requiredLevel = info.level[currentLevel];
			if (creep.level < requiredLevel) continue;

			if (powerOption === PWR_OPERATE_FACTORY) {
				// Special handling for OPERATE_FACTORY.
				if (currentLevel >= this.getDesiredFactoryLevel(creep)) continue;
			}

			const result = creep.upgrade(powerOption);
			hivemind.log('creeps').info('Upgrading power', powerNames[powerOption], 'of power creep', creep.name, ':', result);
			return;
		}
	}

	getDesiredFactoryLevel(creep: PowerCreep): number {
		const levelDistribution = this.getFactoryLevelDistribution();
		const currentLevel = (creep.powers[PWR_OPERATE_FACTORY] || {}).level || 0;

		if (currentLevel > 0) {
			if ((levelDistribution[currentLevel] || 0) >= (levelDistribution[currentLevel + 1] || 0) + 2) {
				return Math.min(currentLevel + 1, POWER_INFO[PWR_OPERATE_FACTORY].level.length);
			}

			return currentLevel;
		}

		for (let i = 1; i < POWER_INFO[PWR_OPERATE_FACTORY].level.length; i++) {
			if ((levelDistribution[i] || 0) >= (levelDistribution[i + 1] || 0) + 2) {
				return currentLevel;
			}
		}

		return currentLevel + 1;
	}

	getFactoryLevelDistribution(): Record<number, number> {
		return cache.inObject(this, 'facLevelDist', 1, () => _.countBy(Game.powerCreeps, c => (c.powers[PWR_OPERATE_FACTORY] || {}).level || 0));
	}

	createNewPowerCreep() {
		const name = this.getOperatorName();
		PowerCreep.create(name, POWER_CLASS.OPERATOR);
		hivemind.log('creeps').info('Created new power creep:', name);
	}

	getOperatorName(): string {
		// Use operator name list from config.
		const names: string[] = hivemind.settings.get('operatorNames');
		for (const name of names || []) {
			if (!Game.powerCreeps[name]) return name;
		}

		// Fallback to numbered names.
		return 'Op' + _.size(_.filter(Game.powerCreeps, creep => creep.name.startsWith('Op')));
	}
}
