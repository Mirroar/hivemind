'use strict';

/* global hivemind PowerCreep POWER_CREEP_MAX_LEVEL POWER_CLASS POWER_INFO
PWR_OPERATE_FACTORY */

const Process = require('./process');

module.exports = class ManagePowerCreepsProcess extends Process {
	/**
	 * Upgrade power creeps depending on our needs.
	 */
	run() {
		const usedGpl = _.sum(_.map(Game.powerCreeps, creep => creep.level + 1));
		if (usedGpl >= Game.gpl.level) return;

		hivemind.log('creeps').info('Unused power creep levels:', Game.gpl.level - usedGpl);

		const smallPCLevel = hivemind.settings.get('operatorEachRoom');
		const creepToUpgrade = _.min(Game.powerCreeps, creep => creep.level);
		if (creepToUpgrade.level < POWER_CREEP_MAX_LEVEL && (!smallPCLevel || creepToUpgrade.level < smallPCLevel)) {
			this.upgradePowerCreep(creepToUpgrade);
		}
		else if (Game.gpl.level - usedGpl > 1) {
			// Create a power creep if we can assign at least one power.
			this.createNewPowerCreep();
		}
	}

	upgradePowerCreep(creep) {
		for (const powerOption of hivemind.settings.get('powerPriorities')) {
			// Check if this power could be upgraded.
			const info = POWER_INFO[powerOption];
			const currentLevel = (creep.powers[powerOption] || {}).level || 0;
			if (currentLevel >= info.level.length) continue;

			const requiredLevel = info.level[currentLevel];
			if (creep.level < requiredLevel) continue;

			// @todo Special handling for OPERATE_FACTORY.
			if (powerOption === PWR_OPERATE_FACTORY) {
				continue;
			}

			const result = creep.upgrade(powerOption);
			hivemind.log('creeps').info('Upgrading power', powerOption, 'of power creep', creep.name, ':', result);
			return;
		}
	}

	createNewPowerCreep() {
		PowerCreep.create('Op' + _.size(_.filter(Game.powerCreeps, creep => creep.name.startsWith('Op'))), POWER_CLASS.OPERATOR);
	}
};
