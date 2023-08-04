import {getCostMatrix, getDangerMatrix} from 'utils/cost-matrix';
import {handleMapArea} from 'utils/map';

declare global {
	interface Creep {
		_blockingCreepMovement?: Creep | PowerCreep;
		_hasMoveIntent?: boolean;
		_requestedMoveArea?: {
			pos: RoomPosition;
			range: number;
		};
		_alternatePositions?: RoomPosition[];
	}

	interface PowerCreep {
		_blockingCreepMovement?: Creep | PowerCreep;
		_hasMoveIntent?: boolean;
		_requestedMoveArea?: {
			pos: RoomPosition;
			range: number;
		};
		_alternatePositions?: RoomPosition[];
	}
}

export default class TrafficManager {
	dangerMatrix: CostMatrix;

	setPreferredArea(creep: Creep | PowerCreep, center: RoomPosition, range: number) {
		creep._requestedMoveArea = {
			pos: center,
			range,
		}
	}

	setAlternatePositions(creep: Creep | PowerCreep, positions: RoomPosition[]) {
		creep._alternatePositions = positions;
	}

	hasAlternatePosition(creep: Creep | PowerCreep) {
		return Boolean(creep._requestedMoveArea) || Boolean(creep._alternatePositions);
	}

	setMoving(creep: Creep | PowerCreep) {
		creep._hasMoveIntent = true;
	}

	/**
	 * Notify a creep that it's blocking another one.
	 *
	 * @param {Creep | PowerCreep} creep The creep being blocked.
	 * @param {Creep | PowerCreep} blockingCreep The creep blocking the path.
	 */
	setBlockingCreep(creep: Creep | PowerCreep, blockingCreep: Creep | PowerCreep) {
		blockingCreep._blockingCreepMovement = creep;
	}

	manageTraffic() {
		// Move blocking creeps if necessary.
		_.each(Game.creeps, creep => {
			if (!creep._blockingCreepMovement) return;
			if (creep._hasMoveIntent) return;

			const blockedCreep = creep._blockingCreepMovement;
			if (blockedCreep instanceof Creep && blockedCreep.fatigue) return;

			this.dangerMatrix = getDangerMatrix(creep.room.name);

			if (creep.pos.getRangeTo(blockedCreep) === 1) {
				const alternatePosition = this.getAlternateCreepPosition(creep);
				if (alternatePosition) {
					// Move aside for the other creep.
					creep.move(creep.pos.getDirectionTo(alternatePosition));
					blockedCreep.move(blockedCreep.pos.getDirectionTo(creep.pos));
				}
				else {
					// Swap with blocked creep.
					creep.move(creep.pos.getDirectionTo(blockedCreep.pos));
					blockedCreep.move(blockedCreep.pos.getDirectionTo(creep.pos));
				}
			}
			else {
				blockedCreep.moveTo(creep.pos, {range: 1});
			}
			creep._hasMoveIntent = true;
		});
	}

	getAlternateCreepPosition(creep: Creep | PowerCreep): RoomPosition | null {
		if (!creep._requestedMoveArea && !creep._alternatePositions) return null;

		let alternatePosition: RoomPosition;
		const costMatrix = getCostMatrix(creep.room.name, {
			singleRoom: !!creep.memory.singleRoom,
		});

		// @todo If none of the alternate positions are free, check if
		// neighboring creeps can be pushed aside recursively.
		// @todo Prefer moving onto roads / plains instead of swamps.
		let blockingCreeps: Array<Creep | PowerCreep> = [];
		handleMapArea(creep.pos.x, creep.pos.y, (x, y) => {
			if (costMatrix.get(x, y) >= 100) return null;
			if (creep.room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) return null;
			if (this.dangerMatrix.get(x, y) > 0) return null;

			const pos = new RoomPosition(x, y, creep.room.name);
			if (!this.isAvailableAlternatePosition(creep, pos)) return null;

			const blockingCreep = pos.lookFor(LOOK_CREEPS);
			if (blockingCreep.length > 0) {
				blockingCreeps.push(blockingCreep[0]);
				return null;
			}

			const blockingPowerCreep = pos.lookFor(LOOK_POWER_CREEPS);
			if (blockingPowerCreep.length > 0) {
				blockingCreeps.push(blockingPowerCreep[0]);
				return null;
			}

			alternatePosition = pos;
			return false;
		});

		if (!alternatePosition && blockingCreeps.length > 0) {
			for (const blockingCreep of blockingCreeps) {
				if (!blockingCreep.my) continue;
				if (blockingCreep._hasMoveIntent) continue;
				if (blockingCreep._blockingCreepMovement) continue;
				if (blockingCreep instanceof Creep && blockingCreep.fatigue) continue;

				blockingCreep._hasMoveIntent = true;
				const chainedAlternatePosition = this.getAlternateCreepPosition(blockingCreep);
				if (chainedAlternatePosition) {
					// Move aside for the other creep.
					blockingCreep.move(blockingCreep.pos.getDirectionTo(chainedAlternatePosition));
					return blockingCreep.pos;
				}
				delete blockingCreep._hasMoveIntent;
			}
		}

		if (alternatePosition) {
			creep.room.visual.line(alternatePosition.x, alternatePosition.y, creep.pos.x, creep.pos.y, {
				color: '#00ff00',
			});
		}

		return alternatePosition;
	}

	isAvailableAlternatePosition(creep: Creep | PowerCreep, position: RoomPosition): boolean {
		if (creep._requestedMoveArea && position.getRangeTo(creep._requestedMoveArea.pos) <= creep._requestedMoveArea.range) return true;

		if (creep._alternatePositions) {
			for (const alternatePosition of creep._alternatePositions) {
				if (position.isEqualTo(alternatePosition)) return true;
			}
		}

		return false;
	}
}
