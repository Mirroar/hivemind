import defaultSettings from 'settings.default';
import localSettings from 'settings.local';

declare global {
	interface KernelMemory {
		settings?: Record<string, any>;
	}
}

class SettingsManager {
	values: Record<string, any>;

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
	get<T>(key: string): T {
		// @todo Periodically check if a setting was changed in memory.
		return this.values[key] as T;
	}

	/**
	 * Overrides the value for a setting in persistent memory.
	 *
	 * @param {string} key
	 *   The key for the setting to set.
	 * @param {string} value
	 *   The value for the setting to set.
	 */
	set<T>(key: string, value: T) {
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
	reset(key: string) {
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
