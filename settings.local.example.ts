/**
 * Exmple settings file for user settings.
 * 
 * Copy to `src/settings.local.ts` to use this.
 */
const settings: Partial<SettingsObject> = {
	// Visualize nav mesh.
	visualizeNavMesh: true,

	// Don't use certain rooms as remotes.
	remoteMineRoomFilter: Game.shard.name === 'shard0' ? (roomName: string) => {
		if (roomName === 'E4N8') return false;

		return true;
	} : null,
}

export default settings;
