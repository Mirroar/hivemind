export default class LabManager {
	public getReactionFor(room: Room): [ResourceConstant, ResourceConstant] | null {
		const roomData = room.getResourceState();
		if (!roomData) return null;

		// Try to find possible reactions where we have a good amount of resources.
		let bestReaction = null;
		let mostResources = null;
		_.each(roomData.totalResources, (amount, resourceType) => {
			if (amount <= 0 || !REACTIONS[resourceType]) return;

			_.each(REACTIONS[resourceType], (targetType, resourceType2) => {
				const amount2 = roomData.totalResources[resourceType2] || 0;
				const resultAmount = roomData.totalResources[targetType] || 0;

				// Don't produce too many T1 boosts. Anything else is unlimited.
				if (resultAmount > 10_000 && targetType.length === 2) return;
				if (amount2 <= 0) return;

				// Also prioritize reactions whose product we don't have much of.
				const maxProduction = Math.min(amount, amount2) - resultAmount;

				if (!mostResources || mostResources < maxProduction) {
					mostResources = maxProduction;
					bestReaction = [resourceType, resourceType2];
				}
			});
		});

		return bestReaction;
	}
}
