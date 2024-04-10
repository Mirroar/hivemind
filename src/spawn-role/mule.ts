/* global hivemind MOVE CARRY */

import BodyBuilder from 'creep/body-builder';
import SpawnRole from 'spawn-role/spawn-role';
import TradeRoute from 'trade-route';

declare global {
	interface MuleSpawnOption extends SpawnOption {
		routeName: string;
	}
}

export default class MuleSpawnRole extends SpawnRole {
	/**
	 * Adds mule spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): MuleSpawnOption[] {
		if (!room.storage) return [];

		return this.cacheEmptySpawnOptionsFor(room, 100, () => {
			const options: MuleSpawnOption[] = [];
			_.each(Memory.tradeRoutes, (mem, routeName) => {
				const tradeRoute = new TradeRoute(routeName);
				if (!tradeRoute.isActive()) return;
				if (tradeRoute.getOrigin() !== room.name) return;
				const resourceType = tradeRoute.getResourceType();
				const storedAmount = room.getCurrentResourceAmount(resourceType);
				const minAmount = resourceType === RESOURCE_ENERGY ? 5000 : 1000;
				if (storedAmount < minAmount) return;

				const numberMules = _.filter(Game.creepsByRole.mule || [], (creep: MuleCreep) => creep.memory.origin === room.name && creep.memory.route === routeName).length;
				// @todo Allow more mules at low priority if a lot of resources need
				// delivering.
				if (numberMules > 0) return;

				options.push({
					priority: 2,
					weight: 1.2,
					routeName,
				});
			});

			return options;
		});
	}

	/**
	 * Gets the body of a creep to be spawned.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object} option
	 *   The spawn option for which to generate the body.
	 *
	 * @return {string[]}
	 *   A list of body parts the new creep should consist of.
	 */
	getCreepBody(room: Room): BodyPartConstant[] {
		return (new BodyBuilder())
			.setWeights({[CARRY]: 1})
			.setEnergyLimit(Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable) * 0.7)
			.build();
	}

	/**
	 * Gets memory for a new creep.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object} option
	 *   The spawn option for which to generate the body.
	 *
	 * @return {Object}
	 *   The boost compound to use keyed by body part type.
	 */
	getCreepMemory(room: Room, option: MuleSpawnOption): MuleCreepMemory {
		return {
			origin: room.name,
			route: option.routeName,
		};
	}

	getCreepBoosts(room: Room, option: MuleSpawnOption, body: BodyPartConstant[]) {
		if (room.getEffectiveAvailableEnergy() < 20_000) return {};

		return this.generateCreepBoosts(room, body, CARRY, 'capacity');
	}
}
