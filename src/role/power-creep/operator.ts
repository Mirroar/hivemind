/* global RoomPosition OK POWER_INFO PWR_GENERATE_OPS PWR_REGEN_SOURCE
PWR_OPERATE_STORAGE PWR_OPERATE_SPAWN RESOURCE_OPS STORAGE_CAPACITY
STRUCTURE_SPAWN PWR_OPERATE_EXTENSION RESOURCE_ENERGY
PWR_REGEN_MINERAL POWER_CREEP_LIFE_TIME PWR_OPERATE_TOWER */

import cache from 'utils/cache';
import Role from 'role/role';
import utilities from 'utilities';
import {ENEMY_STRENGTH_NONE} from 'room-defense';

declare global {
	interface PowerCreep {
		_powerUsed;
	}

	interface PowerCreepMemory {
		newTargetRoom: string;
		order: OperatorOrder;
	}
}

interface OperatorOrderInterface {
	priority: number;
	weight: number;
	canInterrupt?: boolean;
	type: string;
}

interface OperatorWaitOrder extends OperatorOrderInterface {
	type: 'performWait';
	timer: number;
}

interface OperatorEnablePowersOrder extends OperatorOrderInterface {
	type: 'performEnablePowers';
}

interface OperatorRenewOrder extends OperatorOrderInterface {
	type: 'performRenew';
}

interface OperatorUsePowerOrder extends OperatorOrderInterface {
	type: 'usePower';
	power: PowerConstant;
	target?: Id<RoomObject & _HasId>;
}

interface OperatorDepositOpsOrder extends OperatorOrderInterface {
	type: 'depositOps';
	target?: Id<AnyStoreStructure>;
}

interface OperatorRetrieveOpsOrder extends OperatorOrderInterface {
	type: 'retrieveOps';
	target?: Id<AnyStoreStructure>;
}

type OperatorOrder = OperatorWaitOrder
| OperatorEnablePowersOrder
| OperatorRenewOrder
| OperatorUsePowerOrder
| OperatorDepositOpsOrder
| OperatorRetrieveOpsOrder;

export default class OperatorRole extends Role {
	creep: PowerCreep;

	/**
	 * Makes a power creep behave like an operator.
	 *
	 * @param {PowerCreep} creep
	 *   The power creep to run logic for.
	 */
	run(creep: PowerCreep) {
		this.creep = creep;

		if (this.creep.memory.newTargetRoom) {
			delete this.creep.memory.singleRoom;
			if (this.moveToTargetRoom()) {
				// Keep generating ops.
				this.generateOps();
				return;
			}

			this.creep.memory.singleRoom = this.creep.memory.newTargetRoom;
			delete this.creep.memory.newTargetRoom;
		}

		if (!this.hasOrder()) {
			this.chooseOrder();
		}

		this.interruptOrderIfNecessary();
		this.performOrder();
		this.generateOps();
	}

	/**
	 * Moves this power creep to its assigned room if possible.
	 *
	 * @returns {boolean}
	 *   True if the creep is in the process of moving to another room.
	 */
	moveToTargetRoom() {
		// If there's a power spawn in the current room, use it if necessary so we
		// can survive long journeys.
		if (this.creep.ticksToLive < POWER_CREEP_LIFE_TIME * 0.8 && this.creep.room.powerSpawn) {
			this.performRenew();

			return true;
		}

		const targetPosition = new RoomPosition(25, 25, this.creep.memory.newTargetRoom);
		if (this.creep.interRoomTravel(targetPosition)) return true;
		if (this.creep.pos.roomName !== targetPosition.roomName) return true;

		return false;
	}

	/**
	 * Checks if an order has been chosen for the current creep.
	 *
	 * @return {boolean}
	 *   True if the creep has an oder.
	 */
	hasOrder(): boolean {
		if (this.creep.memory.order) return true;

		return false;
	}

	/**
	 * Chooses a new order for the current creep.
	 */
	chooseOrder() {
		const options = this.getAllOptions();
		this.creep.memory.order = utilities.getBestOption(options);
	}

	interruptOrderIfNecessary() {
		cache.inHeap('interruptOrderIfNecessary:' + this.creep.name, 10, () => {
			const options = this.getAllOptions();
			const bestOrder = utilities.getBestOption(options);

			if (bestOrder.canInterrupt && this.mayCurrentOrderBeInterrupted()) this.creep.memory.order = bestOrder;

			return true;
		});
	}

	mayCurrentOrderBeInterrupted(): boolean {
		const order = this.creep.memory.order;
		if (!order) return true;
		if (order.type === 'performRenew') return false;
		if (!('target' in order)) return true;

		const targetId: Id<RoomObject & _HasId> = order?.target;
		if (targetId && (Game.getObjectById(targetId)?.pos?.getRangeTo(this.creep) || 100) <= 5) {
			return false;
		}

		return true;
	}

	getAllOptions(): OperatorOrder[] {
		const options: OperatorOrder[] = [];

		this.addRenewOptions(options);
		this.addWaitOptions(options);
		this.addEnableRoomOptions(options);
		this.addRegenSourcesOptions(options);
		this.addRegenMineralOptions(options);
		this.addOperateStorageOptions(options);
		this.addOperateSpawnOptions(options);
		this.addOperateFactoryOptions(options);
		this.addOperateExtensionOptions(options);
		this.addOperateTowerOptions(options);
		this.addDepositOpsOptions(options);
		this.addRetrieveOpsOptions(options);

		return options;
	}

	/**
	 * Adds options for renewing the creep's lifespan.
	 *
	 * @param {Array} options
	 *   A list of potential power creep orders.
	 */
	addRenewOptions(options: OperatorOrder[]) {
		if (this.creep.ticksToLive > 500) return;
		if (!this.creep.room.powerSpawn) return;

		const option: OperatorRenewOrder = {
			type: 'performRenew',
			priority: 4,
			weight: 1,
		};

		if (this.creep.ticksToLive < 200) option.priority++;

		options.push(option);
	}

	/**
	 * Adds options for waiting when there is nothing else to do.
	 *
	 * @param {Array} options
	 *   A list of potential power creep orders.
	 */
	addWaitOptions(options: OperatorOrder[]) {
		options.push({
			type: 'performWait',
			priority: 1,
			weight: 0,
			timer: 5,
		});
	}

	/**
	 * Adds options for enabling power use in the current room.
	 *
	 * @param {Array} options
	 *   A list of potential power creep orders.
	 */
	addEnableRoomOptions(options: OperatorOrder[]) {
		if (!this.creep.room.controller || this.creep.room.controller.isPowerEnabled) return;

		options.push({
			type: 'performEnablePowers',
			priority: 5,
			weight: 0,
		});
	}

	/**
	 * Adds options for regenerating energy sources.
	 *
	 * @param {Array} options
	 *   A list of potential power creep orders.
	 */
	addRegenSourcesOptions(options: OperatorOrder[]) {
		if (!this.creep.powers[PWR_REGEN_SOURCE]) return;
		if (this.creep.powers[PWR_REGEN_SOURCE].level < 1) return;
		if (this.creep.powers[PWR_REGEN_SOURCE].cooldown > 0) return;

		_.each(this.creep.room.sources, (source: Source) => {
			const activeEffect = _.first(_.filter(source.effects, effect => effect.effect === PWR_REGEN_SOURCE));
			const ticksRemaining = activeEffect ? activeEffect.ticksRemaining : 0;
			if (ticksRemaining > POWER_INFO[PWR_REGEN_SOURCE].duration / 5) return;

			options.push({
				type: 'usePower',
				power: PWR_REGEN_SOURCE,
				target: source.id,
				priority: 3,
				weight: 2 - (10 * ticksRemaining / POWER_INFO[PWR_REGEN_SOURCE].duration),
			});
		});
	}

	/**
	 * Adds options for regenerating mineral sources.
	 *
	 * @param {Array} options
	 *   A list of potential power creep orders.
	 */
	addRegenMineralOptions(options: OperatorOrder[]) {
		if (!this.creep.powers[PWR_REGEN_MINERAL]) return;
		if (this.creep.powers[PWR_REGEN_MINERAL].level < 1) return;

		for (const mineral of this.creep.room.minerals) {
			if (mineral.ticksToRegeneration && mineral.ticksToRegeneration > 0) return;

			const distance = this.creep.pos.getRangeTo(mineral);
			const maxCooldown = distance;
			if (this.creep.powers[PWR_REGEN_MINERAL].cooldown > maxCooldown) return;

			const activeEffect = _.first(_.filter(mineral.effects, effect => effect.effect === PWR_REGEN_MINERAL));
			const ticksRemaining = activeEffect ? activeEffect.ticksRemaining : 0;
			if (ticksRemaining > maxCooldown + POWER_INFO[PWR_REGEN_MINERAL].duration / 5) return;

			options.push({
				type: 'usePower',
				power: PWR_REGEN_MINERAL,
				target: mineral.id,
				priority: 3,
				weight: 1 - (5 * ticksRemaining / POWER_INFO[PWR_REGEN_MINERAL].duration),
				canInterrupt: false,
			});
		}
	}

	/**
	 * Adds options for operating a storage, increasing its size.
	 *
	 * @param {Array} options
	 *   A list of potential power creep orders.
	 */
	addOperateStorageOptions(options: OperatorOrder[]) {
		if (!this.creep.powers[PWR_OPERATE_STORAGE]) return;
		if (this.creep.powers[PWR_OPERATE_STORAGE].level < 1) return;
		if (this.creep.powers[PWR_OPERATE_STORAGE].cooldown > 0) return;
		if ((this.creep.store[RESOURCE_OPS] || 0) < POWER_INFO[PWR_OPERATE_STORAGE].ops) return;

		const storage: StructureStorage = this.creep.room.storage;
		if (!storage) return;
		if (storage.store.getUsedCapacity() < STORAGE_CAPACITY * 0.9) return;

		const activeEffect = _.first(_.filter(storage.effects, effect => effect.effect === PWR_OPERATE_STORAGE));
		const ticksRemaining = activeEffect ? activeEffect.ticksRemaining : 0;
		if (ticksRemaining > POWER_INFO[PWR_OPERATE_STORAGE].duration / 5) return;

		options.push({
			type: 'usePower',
			power: PWR_OPERATE_STORAGE,
			target: storage.id,
			priority: 4,
			weight: 1 - (5 * ticksRemaining / POWER_INFO[PWR_OPERATE_STORAGE].duration),
		});
	}

	/**
	 * Adds options for operating a spawn, speeding up spawning.
	 *
	 * @param {Array} options
	 *   A list of potential power creep orders.
	 */
	addOperateSpawnOptions(options: OperatorOrder[]) {
		if (!this.creep.powers[PWR_OPERATE_SPAWN]) return;
		if (this.creep.powers[PWR_OPERATE_SPAWN].level < 1) return;
		if (this.creep.powers[PWR_OPERATE_SPAWN].cooldown > 0) return;
		if ((this.creep.store[RESOURCE_OPS] || 0) < POWER_INFO[PWR_OPERATE_SPAWN].ops) return;

		// @todo Make sure we're not waiting on energy.

		const spawn = _.find(this.creep.room.myStructuresByType[STRUCTURE_SPAWN], spawn => {
			const activeEffect = _.first(_.filter(spawn.effects, effect => effect.effect === PWR_OPERATE_SPAWN));
			const ticksRemaining = activeEffect ? activeEffect.ticksRemaining : 0;
			if (ticksRemaining > 50) return false;

			// Make sure the spawn actually needs support with spawning.
			const memory = spawn.heapMemory;
			const historyChunkLength = 200;
			const totalTicks = memory.ticks + ((memory.history?.length || 0) * historyChunkLength);
			const spawningTicks = _.reduce(memory.history, (total, h: any) => total + h.spawning, memory.spawning);

			if ((memory.options || 0) < 2 && spawningTicks / totalTicks < 0.8) return false;

			return true;
		});
		if (!spawn) return;

		const activeEffect = _.first(_.filter(spawn.effects, effect => effect.effect === PWR_OPERATE_SPAWN));
		const ticksRemaining = activeEffect ? activeEffect.ticksRemaining : 0;
		options.push({
			type: 'usePower',
			power: PWR_OPERATE_SPAWN,
			target: spawn.id,
			priority: 4,
			weight: 1 - (5 * ticksRemaining / POWER_INFO[PWR_OPERATE_SPAWN].duration),
		});
	}

	/**
	 * Adds options for operating a storage, increasing its size.
	 *
	 * @param {Array} options
	 *   A list of potential power creep orders.
	 */
	addOperateFactoryOptions(options: OperatorOrder[]) {
		if (!this.creep.powers[PWR_OPERATE_FACTORY]) return;
		const powerLevel = this.creep.powers[PWR_OPERATE_FACTORY].level;
		if (powerLevel < 1) return;
		if (this.creep.powers[PWR_OPERATE_FACTORY].cooldown > 0) return;
		if ((this.creep.store[RESOURCE_OPS] || 0) < POWER_INFO[PWR_OPERATE_FACTORY].ops) return;

		const factory = this.creep.room.factory;
		if (!factory) return;
		if (!this.creep.room.factoryManager) return;

		const tasks = this.creep.room.factoryManager.getJobs();
		if (_.filter(tasks, t => t.level === powerLevel).length === 0) return;

		const activeEffect = _.first(_.filter(factory.effects, effect => effect.effect === PWR_OPERATE_FACTORY));
		const ticksRemaining = activeEffect ? activeEffect.ticksRemaining : 0;
		if (ticksRemaining > POWER_INFO[PWR_OPERATE_FACTORY].duration / 5) return;

		options.push({
			type: 'usePower',
			power: PWR_OPERATE_FACTORY,
			target: factory.id,
			priority: 4,
			weight: 1 - (5 * ticksRemaining / POWER_INFO[PWR_OPERATE_FACTORY].duration),
		});
	}

	/**
	 * Adds options for operating extensions, speeding up spawning.
	 *
	 * @param {Array} options
	 *   A list of potential power creep orders.
	 */
	addOperateExtensionOptions(options: OperatorOrder[]) {
		if (!this.creep.powers[PWR_OPERATE_EXTENSION]) return;
		if (this.creep.powers[PWR_OPERATE_EXTENSION].level < 1) return;
		if (this.creep.powers[PWR_OPERATE_EXTENSION].cooldown > 0) return;
		if ((this.creep.store[RESOURCE_OPS] || 0) < POWER_INFO[PWR_OPERATE_EXTENSION].ops) return;

		// Don't operate extensions if they're almost full anyways.
		if (this.creep.room.energyAvailable > this.creep.room.energyCapacityAvailable * 0.8) return;

		const spawn = _.find(this.creep.room.myStructuresByType[STRUCTURE_SPAWN], spawn => {
			// Make sure the spawn actually needs support with spawning.
			if ((spawn.heapMemory.options || 0) < 2) return false;

			// Don't support if there is still time for transporters to handle refilling.
			if (spawn.spawning && spawn.spawning.remainingTime > 5) return false;

			return true;
		});
		if (!spawn) return;

		const storage = this.creep.room.getBestStorageSource(RESOURCE_ENERGY);
		if (!storage) return;

		options.push({
			type: 'usePower',
			power: PWR_OPERATE_EXTENSION,
			target: storage.id,
			priority: 3,
			weight: 1,
		});
	}

	/**
	 * Adds options for operating a storage, increasing its size.
	 *
	 * @param {Array} options
	 *   A list of potential power creep orders.
	 */
	addOperateTowerOptions(options: OperatorOrder[]) {
		if (!this.creep.powers[PWR_OPERATE_TOWER]) return;
		if (this.creep.powers[PWR_OPERATE_TOWER].level < 1) return;
		if (this.creep.powers[PWR_OPERATE_TOWER].cooldown > 0) return;
		if ((this.creep.store[RESOURCE_OPS] || 0) < POWER_INFO[PWR_OPERATE_TOWER].ops) return;
		if (this.creep.room.defense.getEnemyStrength() === ENEMY_STRENGTH_NONE) return;

		const towers: StructureTower[] = this.creep.room.myStructuresByType[STRUCTURE_TOWER];
		if (!towers || towers.length === 0) return;

		for (const tower of towers) {
			const activeEffect = _.first(_.filter(tower.effects, effect => effect.effect === PWR_OPERATE_TOWER));
			const ticksRemaining = activeEffect ? activeEffect.ticksRemaining : 0;
			if (ticksRemaining > POWER_INFO[PWR_OPERATE_TOWER].duration / 5) continue;

			options.push({
				type: 'usePower',
				power: PWR_OPERATE_TOWER,
				target: tower.id,
				priority: 5,
				weight: 1 - (5 * ticksRemaining / POWER_INFO[PWR_OPERATE_TOWER].duration),
			});
		}
	}

	/**
	 * Adds options for transferring extra ops to storage.
	 *
	 * @param {Array} options
	 *   A list of potential power creep orders.
	 */
	addDepositOpsOptions(options: OperatorOrder[]) {
		if (!this.creep.store[RESOURCE_OPS]) return;
		if (this.creep.store.getUsedCapacity() < this.creep.store.getCapacity() * 0.9) return;

		const storage = this.creep.room.getBestStorageTarget(this.creep.store[RESOURCE_OPS], RESOURCE_OPS);
		if (!storage) return;

		options.push({
			type: 'depositOps',
			target: storage.id,
			priority: 2,
			weight: 0,
		});
	}

	/**
	 * Adds options for transferring extra ops to storage.
	 *
	 * @param {Array} options
	 *   A list of potential power creep orders.
	 */
	addRetrieveOpsOptions(options: OperatorOrder[]) {
		if ((this.creep.store[RESOURCE_OPS] || 0) > this.creep.store.getCapacity() * 0.1) return;

		const storage = this.creep.room.getBestStorageSource(RESOURCE_OPS);
		if (!storage) return;

		options.push({
			type: 'retrieveOps',
			target: storage.id,
			priority: 2,
			weight: 0,
		});
	}

	/**
	 * Runs the current order for the active creep.
	 */
	performOrder() {
		if (!this.hasOrder()) return;

		const order = this.creep.memory.order;
		if ('target' in order) {
			const target = Game.getObjectById<RoomObject & _HasId>(order.target);

			if (!target || target.pos.roomName !== this.creep.pos.roomName) {
				delete this.creep.memory.order;
				return;
			}
		}

		this[order.type]();
	}

	/**
	 * Renews this creep's lifespan.
	 */
	performRenew() {
		const powerSpawn = this.creep.room.powerSpawn;

		// @todo Move to another room with a power spawn or a nearby power bank.
		if (!powerSpawn) return;

		this.creep.whenInRange(1, powerSpawn, () => {
			if (this.creep.renew(powerSpawn) === OK) this.orderFinished();
		});
	}

	/**
	 * Makes this creep wait around for a while.
	 */
	performWait() {
		const order = this.creep.memory.order as OperatorWaitOrder;
		order.timer--;
		if (order.timer <= 0) {
			this.orderFinished();
		}

		if (!this.creep.room.roomPlanner) return;

		const targetPos = _.sample(this.creep.room.roomPlanner.getLocations('helper_parking'));
		if (!targetPos) return;

		this.creep.whenInRange(1, targetPos, () => {
			// Wait around menacingly!
		});
	}

	/**
	 * Makes this creep enable power usage in a room.
	 */
	performEnablePowers() {
		this.creep.whenInRange(1, this.creep.room.controller, () => {
			if (this.creep.enableRoom(this.creep.room.controller) === OK) this.orderFinished();
		});
	}

	/**
	 * Makes this creep use a power.
	 */
	usePower() {
		const order = this.creep.memory.order as OperatorUsePowerOrder;
		const power = order.power;
		const powerInfo = POWER_INFO[power];
		const range = 'range' in powerInfo ? powerInfo.range : 1;
		const target = order.target && Game.getObjectById<RoomObject & _HasId>(order.target);

		const execute = () => {
			if (this.creep.usePower(power, target) === OK) {
				this.creep._powerUsed = true;
				this.orderFinished();
			}
		};

		if (target) {
			this.creep.whenInRange(range, target, execute);
		}
		else {
			execute();
		}
	}

	/**
	 *
	 */
	depositOps() {
		const order = this.creep.memory.order as OperatorDepositOpsOrder;
		const storage = Game.getObjectById<AnyStoreStructure>(order.target);
		if (!storage) {
			this.orderFinished();
			return;
		}

		const amount = Math.min(Math.floor(this.creep.store.getCapacity() / 2), this.creep.store[RESOURCE_OPS] || 0, storage.store.getFreeCapacity(RESOURCE_OPS));
		if (!amount) {
			this.orderFinished();
			return;
		}

		this.creep.whenInRange(1, storage, () => {
			if (this.creep.transfer(storage, RESOURCE_OPS, amount) === OK) this.orderFinished();
		});
	}

	/**
	 *
	 */
	retrieveOps() {
		const order = this.creep.memory.order as OperatorRetrieveOpsOrder;
		const storage = Game.getObjectById<AnyStoreStructure>(order.target);
		if (!storage) {
			this.orderFinished();
			return;
		}

		const amount = Math.min(Math.floor(this.creep.store.getCapacity() / 2), storage.store[RESOURCE_OPS] || 0, this.creep.store.getFreeCapacity());
		if (!amount) {
			this.orderFinished();
			return;
		}

		this.creep.whenInRange(1, storage, () => {
			if (this.creep.withdraw(storage, RESOURCE_OPS, amount) === OK) this.orderFinished();
		});
	}

	/**
	 * Marks the current order as finished.
	 */
	orderFinished() {
		delete this.creep.memory.order;
	}

	/**
	 * Makes the creep generate ops resources.
	 */
	generateOps() {
		if (this.creep.room.controller && !this.creep.room.controller.isPowerEnabled) return;
		if (this.creep._powerUsed) return;
		if (this.creep.store.getFreeCapacity() === 0) return;
		if (!this.creep.powers[PWR_GENERATE_OPS]) return;
		if (this.creep.powers[PWR_GENERATE_OPS].level < 1) return;
		if (this.creep.powers[PWR_GENERATE_OPS].cooldown > 0) return;
		if (this.creep.room.isMine() && this.creep.room.getCurrentResourceAmount(RESOURCE_OPS) > 15_000) return;

		this.creep.usePower(PWR_GENERATE_OPS);
	}
}
