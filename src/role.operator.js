'use strict';

/* global OK POWER_INFO PWR_GENERATE_OPS PWR_REGEN_SOURCE PWR_REGEN_MINERAL
PWR_OPERATE_STORAGE RESOURCE_OPS */

const utilities = require('./utilities');
const Role = require('./role');

const OperatorRole = function () {
	Role.call(this);
};

OperatorRole.prototype = Object.create(Role.prototype);

/**
 * Makes a power creep behave like an operator.
 *
 * @param {PowerCreep} creep
 *   The power creep to run logic for.
 */
OperatorRole.prototype.run = function (creep) {
	this.creep = creep;
	if (!this.hasOrder()) {
		this.chooseOrder();
	}

	this.performOrder();

	this.generateOps();
};

/**
 * Checks if an order has been chosen for the current creep.
 *
 * @return {boolean}
 *   True if the creep has an oder.
 */
OperatorRole.prototype.hasOrder = function () {
	if (this.creep.memory.order) {
		return true;
	}

	return false;
};

/**
 * Chooses a new order for the current creep.
 */
OperatorRole.prototype.chooseOrder = function () {
	const options = [];

	this.addRenewOptions(options);
	this.addWaitOptions(options);
	this.addEnableRoomOptions(options);
	this.addRegenSourcesOptions(options);
	this.addRegenMineralOptions(options);
	this.addOperateStorageOptions(options);

	this.creep.memory.order = utilities.getBestOption(options);
};

/**
 * Adds options for renewing the creep's lifespan.
 *
 * @param {Array} options
 *   A list of potential power creep orders.
 */
OperatorRole.prototype.addRenewOptions = function (options) {
	if (this.creep.ticksToLive > 500) return;
	if (!this.creep.room.powerSpawn) return;

	const option = {
		type: 'performRenew',
		priority: 4,
		weight: 1,
	};

	if (this.creep.ticksToLive < 200) option.priority++;

	options.push(option);
};

/**
 * Adds options for waiting when there is nothing else to do.
 *
 * @param {Array} options
 *   A list of potential power creep orders.
 */
OperatorRole.prototype.addWaitOptions = function (options) {
	options.push({
		type: 'performWait',
		priority: 1,
		weight: 0,
		timer: 10,
	});
};

/**
 * Adds options for enabling power use in the current room.
 *
 * @param {Array} options
 *   A list of potential power creep orders.
 */
OperatorRole.prototype.addEnableRoomOptions = function (options) {
	if (this.creep.room.controller.isPowerEnabled) return;

	options.push({
		type: 'performEnablePowers',
		priority: 5,
		weight: 0,
	});
};

/**
 * Adds options for regenerating energy sources.
 *
 * @param {Array} options
 *   A list of potential power creep orders.
 */
OperatorRole.prototype.addRegenSourcesOptions = function (options) {
	if (!this.creep.powers[PWR_REGEN_SOURCE]) return;
	if (this.creep.powers[PWR_REGEN_SOURCE].level < 1) return;
	if (this.creep.powers[PWR_REGEN_SOURCE].cooldown > 0) return;

	_.each(this.creep.room.sources, source => {
		const activeEffect = _.first(_.filter(source.effects, effect => effect.power === PWR_REGEN_SOURCE));
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
};

/**
 * Adds options for regenerating mineral sources.
 *
 * @param {Array} options
 *   A list of potential power creep orders.
 */
OperatorRole.prototype.addRegenMineralOptions = function (options) {
	if (!this.creep.powers[PWR_REGEN_MINERAL]) return;
	if (this.creep.powers[PWR_REGEN_MINERAL].level < 1) return;
	if (this.creep.powers[PWR_REGEN_MINERAL].cooldown > 0) return;

	const mineral = this.creep.room.mineral;
	if (!mineral) return;
	if (mineral.ticksToRegeneration && mineral.ticksToRegeneration > 0) return;

	const activeEffect = _.first(_.filter(mineral.effects, effect => effect.power === PWR_REGEN_MINERAL));
	const ticksRemaining = activeEffect ? activeEffect.ticksRemaining : 0;
	if (ticksRemaining > POWER_INFO[PWR_REGEN_MINERAL].duration / 5) return;

	options.push({
		type: 'usePower',
		power: PWR_REGEN_MINERAL,
		target: mineral.id,
		priority: 3,
		weight: 1 - (5 * ticksRemaining / POWER_INFO[PWR_REGEN_MINERAL].duration),
	});
};

/**
 * Adds options for operating a storage, increasing its size.
 *
 * @param {Array} options
 *   A list of potential power creep orders.
 */
OperatorRole.prototype.addOperateStorageOptions = function (options) {
	if (!this.creep.powers[PWR_OPERATE_STORAGE]) return;
	if (this.creep.powers[PWR_OPERATE_STORAGE].level < 1) return;
	if (this.creep.powers[PWR_OPERATE_STORAGE].cooldown > 0) return;
	if ((this.creep.carry[RESOURCE_OPS] || 0) < POWER_INFO[PWR_OPERATE_STORAGE].ops) return;

	const storage = this.creep.room.storage;
	if (!storage) return;

	const activeEffect = _.first(_.filter(storage.effects, effect => effect.power === PWR_OPERATE_STORAGE));
	const ticksRemaining = activeEffect ? activeEffect.ticksRemaining : 0;
	if (ticksRemaining > POWER_INFO[PWR_OPERATE_STORAGE].duration / 5) return;

	options.push({
		type: 'usePower',
		power: PWR_OPERATE_STORAGE,
		target: storage.id,
		priority: 4,
		weight: 1 - (5 * ticksRemaining / POWER_INFO[PWR_OPERATE_STORAGE].duration),
	});
};

/**
 * Runs the current order for the active creep.
 */
OperatorRole.prototype.performOrder = function () {
	if (!this.hasOrder()) return;

	this[this.creep.memory.order.type]();
};

/**
 * Renews this creep's lifespan.
 */
OperatorRole.prototype.performRenew = function () {
	const powerSpawn = this.creep.room.powerSpawn;

	if (!powerSpawn) return;

	if (this.creep.pos.getRangeTo(powerSpawn) > 1) {
		this.creep.moveToRange(powerSpawn, 1);
	}
	else if (this.creep.renew(powerSpawn) === OK) {
		this.orderFinished();
	}
};

/**
 * Makes this creep wait around for a while.
 */
OperatorRole.prototype.performWait = function () {
	this.creep.memory.order.timer--;
	if (this.creep.memory.order.timer <= 0) {
		this.orderFinished();
	}

	const targetPos = _.sample(this.creep.room.roomPlanner.getLocations('helper_parking'));
	if (!targetPos) return;

	if (this.creep.pos.getRangeTo(targetPos) > 0) {
		this.creep.goTo(targetPos);
	}
};

/**
 * Makes this creep enable power usage in a room.
 */
OperatorRole.prototype.performEnablePowers = function () {
	if (this.creep.pos.getRangeTo(this.creep.room.controller) > 1) {
		this.creep.moveToRange(this.creep.room.controller, 1);
	}
	else if (this.creep.enableRoom(this.creep.room.controller) === OK) {
		this.orderFinished();
	}
};

/**
 * Makes this creep use a power.
 */
OperatorRole.prototype.usePower = function () {
	const power = this.creep.memory.order.power;
	const target = this.creep.memory.order.target && Game.getObjectById(this.creep.memory.order.target);
	const range = POWER_INFO[power].range || 1;

	if (target && this.creep.pos.getRangeTo(target) > range) {
		this.creep.moveToRange(target, range);
	}
	else if (this.creep.usePower(power, target) === OK) {
		this.creep._powerUsed = true;
		this.orderFinished();
	}
};

/**
 * Marks the current order as finished.
 */
OperatorRole.prototype.orderFinished = function () {
	delete this.creep.memory.order;
};

/**
 * Makes the creep generate ops resources.
 */
OperatorRole.prototype.generateOps = function () {
	if (!this.creep.room.controller.isPowerEnabled) return;
	if (this.creep._powerUsed) return;
	if (_.sum(this.creep.carry) === this.creep.carryCapacity) return;
	if (!this.creep.powers[PWR_GENERATE_OPS]) return;
	if (this.creep.powers[PWR_GENERATE_OPS].level < 1) return;
	if (this.creep.powers[PWR_GENERATE_OPS].cooldown > 0) return;

	this.creep.usePower(PWR_GENERATE_OPS);
};

module.exports = OperatorRole;
