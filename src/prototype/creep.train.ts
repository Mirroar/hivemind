/* global Creep */

interface Creep {
	isPartOfTrain: () => boolean,
	isTrainHead: () => boolean,
	getTrainId: () => Id<Creep>,
	isTrainFullySpawned: () => boolean,
	getTrainParts: () => Creep[],
	isTrainJoined: () => boolean,
	joinTrain: () => void,
}

interface CreepMemory {
	train?: {
		id: Id<Creep>,
		partsToSpawn: number[],
		parts: Id<Creep>[],
	},
}

/**
 * Determines if a creep is part of a creep train.
 *
 * @return {boolean}
 *   True if the creep is part of a train.
 */
Creep.prototype.isPartOfTrain = function (this: Creep): boolean {
	return Boolean(this.memory.train);
};

Creep.prototype.isTrainHead = function (this: Creep): boolean {
	// @todo What if the head dies?
	return this.getTrainId() === this.id;
};

Creep.prototype.getTrainId = function (this: Creep): Id<Creep> {
	return this.memory.train.id || this.id;
};

Creep.prototype.isTrainFullySpawned = function (this: Creep): boolean {
	const trainId = this.getTrainId();
	const headSegment = Game.getObjectById<Creep>(trainId);
	if (headSegment && _.size(headSegment.memory.train.partsToSpawn) > 0) return false;

	return true;
};

Creep.prototype.getTrainParts = function (this: Creep): Creep[] {
	// @todo Guaruantee stable order of creeps.
	const trainId = this.getTrainId();
	let segments: Creep[];
	if (this.memory.train.parts) {
		segments = _.filter(_.map<string, Creep>(this.memory.train.parts, Game.getObjectById));
		if (segments.length < this.memory.train.parts.length) {
			this.memory.train.parts = _.map(segments, 'id');
		}
	}
	else {
		// @todo Order these creeps consistently. We save info redundantly
		// for when individual segments die.
		segments = _.values(_.filter(Game.creeps, creep => creep.isPartOfTrain() && creep.getTrainId() === trainId));
		this.memory.train.parts = _.map(segments, 'id');
	}

	return segments;
};

Creep.prototype.isTrainJoined = function (this: Creep): boolean {
	const segments = this.getTrainParts();

	for (let i = 1; i < segments.length; i++) {
		// We don't care if a train is disjooined across rooms.
		if (segments[i].pos.roomName !== segments[i - 1].pos.roomName) continue;

		// Parts need to be adjacent otherwise.
		if (segments[i].pos.getRangeTo(segments[i - 1].pos) > 1) return false;
	}

	return true;
};

Creep.prototype.joinTrain = function (this: Creep) {
	const segments = this.getTrainParts();

	let canMoveBack = true;
	for (let i = 1; i < segments.length; i++) {
		let moveForward = false;
		let moveBack = false;

		if (segments[i].pos.roomName === segments[i - 1].pos.roomName) {
			const distance = segments[i].pos.getRangeTo(segments[i - 1].pos);
			if (distance > 1) moveForward = true;
			if (distance > 2 && canMoveBack) moveBack = true;
		}
		else {
			moveForward = true;
		}

		if (moveForward) {
			// Move toward previous segment.
			// @todo Instead of moving to the previous part's current position,
			// move to their intended position for next tick for quicker joining.
			segments[i].moveToRange(segments[i - 1].pos, 1);
			canMoveBack = false;
		}

		if (moveBack) {
			// Move this and all previous segments toward next segment.
			segments[i - 1].moveToRange(segments[i].pos, 1);
			for (let j = i - 2; j >= 0; j--) {
				segments[j].move(segments[j].pos.getDirectionTo(segments[j + 1].pos));
			}

			canMoveBack = false;
		}
	}
};
