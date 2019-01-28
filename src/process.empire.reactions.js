'use strict';

/* global hivemind REACTIONS */

const Process = require('./process');

const ReactionsProcess = function (params, data) {
	Process.call(this, params, data);
};

ReactionsProcess.prototype = Object.create(Process.prototype);

/**
 * Sets appropriate reactions for each room depending on available resources.
 */
ReactionsProcess.prototype.run = function () {
	for (const roomName in Game.rooms) {
		// @todo Run as part of OwnedRoomsProcess.
		const room = Game.rooms[roomName];
		const roomData = room.getResourceState();
		if (!roomData) continue;

		if (room && room.isEvacuating()) {
			room.memory.bestReaction = null;
			continue;
		}

		if (room && room.memory.canPerformReactions) {
			// Try to find possible reactions where we have a good amount of resources.
			let bestReaction = null;
			let mostResources = null;
			for (const resourceType in roomData.totalResources) {
				if (roomData.totalResources[resourceType] > 0 && REACTIONS[resourceType]) {
					for (const resourceType2 in REACTIONS[resourceType]) {
						const targetType = REACTIONS[resourceType][resourceType2];
						if (roomData.totalResources[targetType] > 10000) continue;

						if (roomData.totalResources[resourceType2] && roomData.totalResources[resourceType2] > 0) {
							let resourceAmount = Math.min(roomData.totalResources[resourceType], roomData.totalResources[resourceType2]);

							// Also prioritize reactions whose product we don't have much of.
							resourceAmount -= (roomData.totalResources[targetType] || 0);

							if (!mostResources || mostResources < resourceAmount) {
								mostResources = resourceAmount;
								bestReaction = [resourceType, resourceType2];
							}
						}
					}
				}
			}

			room.memory.currentReaction = bestReaction;
			if (bestReaction) {
				hivemind.log('labs', roomName).info('now producing', REACTIONS[bestReaction[0]][bestReaction[1]]);
			}
		}
	}
};

module.exports = ReactionsProcess;
