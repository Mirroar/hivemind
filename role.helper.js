var utilities = require('utilities');

Creep.prototype.performHelperDeliver = function () {
    let storage = this.room.storage;
    let terminal = this.room.terminal;

    for (let id in this.orders) {
        let lab = Game.getObjectById(id);
        if (!lab) continue;

        let resourceType = this.orders[id].resourceType;

        if (this.carry[resourceType] && this.carry[resourceType] > 0) {
            let diff = this.orders[id].resourceAmount - (lab.mineralAmount || 0);
            if (diff > 0) {
                if (this.pos.getRangeTo(lab) > 1) {
                    this.moveToRange(lab, 1);
                }
                else {
                    let amount = Math.min(diff, this.carry[resourceType]);

                    this.transfer(lab, resourceType, amount);
                }
                return true;
            }
        }

        if (this.carry[RESOURCE_ENERGY] && this.carry[RESOURCE_ENERGY] > 0) {
            let diff = this.orders[id].energyAmount - (lab.energy || 0);
            if (diff > 0) {
                if (this.pos.getRangeTo(lab) > 1) {
                    this.moveToRange(lab, 1);
                }
                else {
                    let amount = Math.min(diff, this.carry[RESOURCE_ENERGY]);

                    this.transfer(lab, RESOURCE_ENERGY, amount);
                }
                return true;
            }
        }
    }

    // Nothing to do, store excess energy in labs.
    if (this.carry.energy > 0) {
        let labs = this.room.getBoostLabs();
        for (let i in labs) {
            let lab = labs[i];

            if (lab.energy + this.carry.energy <= lab.energyCapacity) {
                if (this.pos.getRangeTo(lab) > 1) {
                    this.moveToRange(lab, 1);
                }
                else {
                    this.transfer(lab, RESOURCE_ENERGY);
                }
                return true;
            }
        }
    }

    // Nothing to do, store excess energy in terminal.
    if (this.carry.energy > 0 && storage && terminal) {
        if (terminal.store.energy < storage.store.energy * 0.05) {
            if (_.sum(terminal.store) + this.carry.energy <= terminal.storeCapacity) {
                if (this.pos.getRangeTo(terminal) > 1) {
                    this.moveToRange(terminal, 1);
                }
                else {
                    this.transfer(terminal, RESOURCE_ENERGY);
                }
                return true;
            }
        }
    }

    // Store anything else in storage or terminal.
    let target = terminal;
    if (storage && _.sum(storage.store) + _.sum(this.carry) < storage.storeCapacity) {
        target = storage;
    }

    if (this.pos.getRangeTo(target) > 1) {
        this.moveToRange(target, 1);
    }
    else {
        this.transferAny(target);
    }

    return true;
};

Creep.prototype.performHelperGather = function () {
    let storage = this.room.storage;
    let terminal = this.room.terminal;

    for (let id in this.orders) {
        let lab = Game.getObjectById(id);
        if (!lab) continue;

        let resourceType = this.orders[id].resourceType;

        let diff = this.orders[id].resourceAmount - (this.carry[resourceType] || 0) - (lab.mineralAmount || 0);
        if (diff > 0) {
            let target = terminal;
            if (storage && (storage.store[resourceType] || 0) > 1) {
                target = storage;
            }

            if (this.pos.getRangeTo(target) > 1) {
                this.moveToRange(target, 1);
            }
            else {
                let amount = Math.min(diff, this.carryCapacity - _.sum(this.carry));
                amount = Math.min(amount, target.store[resourceType]);

                if (!target.store[resourceType]) {
                    // Something went wrong, we don't actually have enough of this stuff.
                    // Delete any boost orders using this resource.
                    for (let creepName in this.room.boostManager.memory.creepsToBoost) {
                        let resources = this.room.boostManager.memory.creepsToBoost[creepName];
                        for (let rType in resources) {
                            if (rType == resourceType) {
                                delete this.room.boostManager.memory.creepsToBoost[creepName];
                                break;
                            }
                        }
                    }
                    return true;
                }

                this.withdraw(target, resourceType, amount);
            }
            return true;
        }

        diff = this.orders[id].energyAmount - (this.carry[RESOURCE_ENERGY] || 0) - (lab.energy || 0);
        if (diff > 0) {
            let target = terminal;
            if (storage && (storage.store[RESOURCE_ENERGY] || 0) > 0) {
                target = storage;
            }

            if (this.pos.getRangeTo(target) > 1) {
                this.moveToRange(target, 1);
            }
            else {
                let amount = Math.min(diff, this.carryCapacity - _.sum(this.carry));

                this.withdraw(target, RESOURCE_ENERGY, amount);
            }
            return true;
        }
    }

    // Get energy to fill labs when needed.
    let labs = this.room.getBoostLabs();
    for (let i in labs) {
        let lab = labs[i];

        if (lab.energy + this.carryCapacity <= lab.energyCapacity) {
            let target = terminal;
            if (storage && (storage.store[RESOURCE_ENERGY] || 0) > 0) {
                target = storage;
            }

            if (this.pos.getRangeTo(target) > 1) {
                this.moveToRange(target, 1);
            }
            else {
                this.withdraw(target, RESOURCE_ENERGY);
            }
            return true;
        }
    }

    // Get energy to fill terminal when needed.
    if (storage && terminal && terminal.store.energy < storage.store.energy * 0.05) {
        let target = storage;

        if (this.pos.getRangeTo(target) > 1) {
            this.moveToRange(target, 1);
        }
        else {
            this.withdraw(target, RESOURCE_ENERGY);
        }
        return true;
    }

    // If we got here, there's nothing left to gather. Deliver what we have stored.
    if (_.sum(this.carry) > 0) {
        this.setHelperState(true);
    }

    return true;
};

/**
 * Checks if any of the labs have the wrong mineral type assigned, and clears those out.
 */
Creep.prototype.performHelperCleanup = function () {
    let storage = this.room.storage;
    let terminal = this.room.terminal;

    for (let id in this.orders) {
        let lab = Game.getObjectById(id);
        if (!lab) continue;

        if (lab.mineralType && lab.mineralType != this.orders[id].resourceType) {
            if (this.memory.delivering) {
                // Put everything away.
                let target = terminal;
                if (storage && _.sum(storage.store) + _.sum(this.carry) < storage.storeCapacity) {
                    target = storage;
                }

                if (this.pos.getRangeTo(target) > 1) {
                    this.moveToRange(target, 1);
                }
                else {
                    this.transferAny(target);
                }
            }
            else {
                // Clean out lab.
                if (this.pos.getRangeTo(lab) > 1) {
                    this.moveToRange(lab, 1);
                }
                else {
                    this.withdraw(lab, lab.mineralType);
                }
            }

            return true;
        }
    }

    return false;
};

/**
 * Puts this creep into or out of deliver mode.
 */
Creep.prototype.setHelperState = function (delivering) {
    this.memory.delivering = delivering;
};

/**
 * Makes a creep behave like a helper.
 */
Creep.prototype.runHelperLogic = function () {
    if (!this.room.boostManager) return;
    this.orders = this.room.boostManager.getLabOrders();

    if (this.memory.delivering && _.sum(this.carry) == 0) {
        this.setHelperState(false);
    }
    else if (!this.memory.delivering && _.sum(this.carry) == this.carryCapacity) {
        this.setHelperState(true);
    }

    if (this.performHelperCleanup()) {
        return true;
    }

    if (this.memory.delivering) {
        this.performHelperDeliver();
    }
    else {
        this.performHelperGather();
    }
};
