import defaultSettings from 'settings.default';
import localSettings from 'settings.local';

declare global {
	type SettingsObject = {
		allowBuyingEnergy: boolean;
		allowBuyingPixels: boolean;
		allowSellingOps: boolean;
		allowSellingPower: boolean;
		automaticallyUpgradePowerCreeps: boolean;
		constructFactories: boolean;
		constructLabs: boolean;
		constructNukers: boolean;
		constructObservers: boolean;
		constructPowerSpawns: boolean;
		constructWallsUnderRamparts: boolean;
		depositMineRoomFilter?: (roomName: string) => boolean;
		dismantleUnwantedRamparts: boolean;
		enableDepositMining: boolean;
		enablePowerMining: boolean;
		enableTradeManagement: boolean;
		expansionScoreBonusHighwayExit: number;
		expansionScoreCacheDuration: number;
		highwayScoutInterval: number;
		maxDepositCooldown: number;
		maxExpansionCpuPerTick: number;
		maxOwnedRooms?: number;
		maxRangeForDepositMining: number;
		maxRangeForPowerMining: number;
		maxRemoteMinePathLength: number;
		maxRemoteMineRoomDistance: number;
		maxRoomPrioritizationCpuPerTick: number;
		maxScoutsPerRoom: number;
		maxVisitorsPerUser: number;
		maxWallHealth: Record<number, number>;
		minCutRampartDistance: number;
		minEnergyForDepositMining: number;
		minEnergyForNuker: number;
		minEnergyForPowerHarvesting: number;
		minEnergyForPowerProcessing: number;
		minEnergyToUpgradeAtRCL8: number;
		minRclForDepositMining: number;
		minRclForPowerMining: number;
		minWallIntegrity: number;
		newRemoteMiningRoomFilter?: (roomName: string) => boolean;
		notifyFactoryProduction: boolean;
		onTick?: () => void;
		operatorEachRoom: false | number;
		operatorNames: string[];
		powerBankMinAmount: number;
		powerCreepUpgradeCheckInterval: number;
		powerHaulerMoveRatio: number;
		powerMineCreepPriority: number;
		powerMineRoomFilter?: (roomName: string) => boolean;
		powerMiningCheckInterval: number;
		powerPriorities: PowerConstant[];
		powerProcessingEnergyRatio: number;
		prioritizeFactoryLevels: boolean;
		rampartWhitelistedUsers: string[];
		recordRoomStats: boolean;
		remoteMineRoomFilter?: (roomName: string) => boolean;
		roomIntelCacheDuration: number;
		roomScoutInterval: number;
		scoutProcessInterval: number;
		scoutSpawnPriority: number;
		season4EnableCaravanDelivery: boolean;
		treatNonAlliesAsEnemies: boolean;
		visualizeCreepMovement: boolean;
		visualizeNavMesh: boolean;
		visualizeRemoteMines: boolean;
		visualizeRoomPlan: boolean;
		visualizeSpawnQueue: boolean;
	};

	interface KernelMemory {
		settings?: Partial<SettingsObject>;
	}
}

class SettingsManager {
	values: SettingsObject;

	/**
	 * Creates a new SettingsManager instance.
	 *
	 * Settings values will be loaded from files an memory at this point.
	 */
	constructor() {
		// Load base settings.
		this.values = defaultSettings;

		// Add user settings from file.
		if (localSettings) {
			_.each(localSettings, (value, key) => {
				if (typeof this.values[key] === 'undefined') return;

				this.values[key] = value;
			});
		}

		// Add user settings from memory.
		if (Memory.hivemind?.settings) {
			_.each(Memory.hivemind.settings, (value: unknown, key) => {
				if (typeof this.values[key] === 'undefined') return;

				this.values[key] = value;
			});
		}
	}

	/**
	 * Gets the value for a setting.
	 *
	 * @param {string} key
	 *   The key for the setting to get.
	 *
	 * @return {mixed}
	 *   The value for this setting.
	 */
	get<T extends keyof SettingsObject>(key: T) {
		// @todo Periodically check if a setting was changed in memory.
		return this.values[key];
	}

	/**
	 * Overrides the value for a setting in persistent memory.
	 *
	 * @param {string} key
	 *   The key for the setting to set.
	 * @param {string} value
	 *   The value for the setting to set.
	 */
	set<T extends keyof SettingsObject>(key: T, value: SettingsObject[T]) {
		if (typeof this.values[key] === 'undefined') return;
		if (typeof value === 'undefined') return;
		if (!Memory.hivemind.settings) Memory.hivemind.settings = {};

		this.values[key] = value;
		Memory.hivemind.settings[key] = value;
	}

	/**
	 * Removes memory override for a setting.
	 *
	 * @param {string} key
	 *   The key for the setting to reset.
	 */
	reset<T extends keyof SettingsObject>(key: T) {
		// @todo Reload values from local or base settings.
		if (typeof this.values[key] === 'undefined') return;
		if (!Memory.hivemind.settings) return;

		delete Memory.hivemind.settings[key];
	}
}

const settings = new SettingsManager();

export default settings;
export {
	SettingsManager,
};
