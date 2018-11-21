/**
 * Makes this creep take excess resources from storage.
 */
Creep.prototype.performGiftCollection = function () {
  let storage = this.room.storage;
  if (!storage) {
    // Nothing to gift if we have no storage.
    return this.performGiftTransport();
  }
  if (_.sum(this.carry) >= this.carryCapacity * 0.95) {
    // If we're (nearly) full, embark.
    return this.performGiftTransport();
  }

  if (!this.memory.targetResource) {
    return this.chooseGiftResource();
  }

  if (!storage.store[this.memory.targetResource] || storage.store[this.memory.targetResource] <= 0) {
    return this.chooseGiftResource();
  }

  if (this.pos.getRangeTo(storage) > 1) {
    this.moveToRange(storage, 1);
    return;
  }

  this.withdraw(storage, this.memory.targetResource);
  delete this.memory.targetResource;
};

/**
 * Chooses a resource the room is overly full on.
 */
Creep.prototype.chooseGiftResource = function () {
  let tryCount = 0;
  let resourceType = null;
  let resourceTypes = Object.keys(this.room.storage.store);
  do {
    resourceType = _.sample(resourceTypes);
    tryCount++;
  } while (tryCount < 10 && !this.room.isFullOn(resourceType));
  this.memory.targetResource = resourceType;
};

/**
 * Move the creep out of the room by letting it scout.
 */
Creep.prototype.performGiftTransport = function () {
  this.memory.role = 'scout';
};
