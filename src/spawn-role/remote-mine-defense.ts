import type {BrawlerSpawnOption} from 'spawn-role/brawler';
import { decodePosition, encodePosition } from 'utils/serialization';
import cache from 'utils/cache';
import BrawlerSpawnRole from 'spawn-role/brawler';

const RESPONSE_NONE = 0;

/**
 * Spawn role for remote mine defenders.
 */
export default class RemoteMineDefenseSpawnRole extends BrawlerSpawnRole {
	getSpawnOptions(room: Room): SpawnOption[] {
		return this.cacheEmptySpawnOptionsFor(room, 10, () => {
			const options: BrawlerSpawnOption[] = [];
			this.getRemoteDefenseSpawnOptions(room, options);

			// Creeps must use the brawler role so existing behavior code handles them.
			for (const option of options) option.role = 'brawler';

			return options;
		});
	}
    
	/**
	 * Adds brawler spawn options for remote harvest rooms.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getRemoteDefenseSpawnOptions(room: Room, options: BrawlerSpawnOption[]) {
		const harvestPositions: RoomPosition[] = room.getRemoteHarvestSourcePositions();
		for (const pos of harvestPositions) {
			const operation = Game.operationsByType.mining['mine:' + pos.roomName];

			// @todo If the operation has multiple source rooms, use the one
			// that has better spawn capacity or higher RCL.

			// Only spawn if there are enemies.
			if (!operation) continue;
			if (!operation.isUnderAttack() && !operation.hasInvaderCore()) continue;

			// Only do costly defense if we have enough energy.
			if (operation.isUnderAttack() && room.getEffectiveAvailableEnergy() < 5_000) return;

			// Don't defend operations where we still need a dismantler.
			if (operation.isUnderAttack() && operation.needsDismantler()) continue;

			// Only spawn defenders for actively used sources.
			if (!this.isActivelyUsedSource(room, pos)) continue;

			// Don't spawn simple source defenders in quick succession.
			// If they fail, there's a stronger enemy that we need to deal with
			// in a different way.
			const targetPos = encodePosition(new RoomPosition(25, 25, pos.roomName));
			const defenseTimeDiff = operation.isProfitable() ? 300 : 1500;
			if (room.memory.recentBrawler && Game.time - (room.memory.recentBrawler[targetPos] || -10_000) < defenseTimeDiff) continue;

			const brawlers = _.filter(Game.creepsByRole.brawler || [], (creep: BrawlerCreep) => creep.memory.operation === 'mine:' + pos.roomName);
			if (_.size(brawlers) > 0) continue;

			const totalEnemyData = operation.getTotalEnemyData();
			const responseType = this.getDefenseCreepSize(room, totalEnemyData);

			if (responseType === RESPONSE_NONE) continue;

			const sourceLocation = encodePosition(pos);
			options.push({
				priority: 3,
				weight: 1,
				targetPos,
				pathTarget: sourceLocation,
				responseType,
				operation: operation.name,
			});
		}
	}

	isActivelyUsedSource(room: Room, pos: RoomPosition): boolean {
		const roomList: Record<string, boolean> = cache.fromHeap('activeRemoteRooms:' + room.name, true);
		if (roomList?.[pos.roomName]) return true;

		const hasActiveHarvesters = _.some(Game.creepsByRole['harvester.remote'], (creep: RemoteHarvesterCreep) => decodePosition(creep.memory.source).roomName === pos.roomName);
		return hasActiveHarvesters;
	}
}
