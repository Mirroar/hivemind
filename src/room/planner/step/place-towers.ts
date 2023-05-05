import PlacementManager from 'room/planner/placement-manager';
import RoomPlan from 'room/planner/room-plan';
import {encodePosition} from 'utils/serialization';
import {getRoomIntel} from 'room-intel';

interface ScoredTowerPosition {
	pos: RoomPosition,
	score: number,
}

export default class placeTowersStep {
	constructor(
		protected roomPlan: RoomPlan,
		protected placementManager: PlacementManager,
		protected safetyMatrix: CostMatrix,
	) {}

	/**
	 * Places towers so exits are well covered.
	 */
	run(): StepResult {
		// @todo Make sure tower access roads are always behind ramparts!
		let towerCount = 0;

		const positions = this.findTowerPositions();
		const ramparts = this.findRampartPositions();
		// const buildingMatrix = this.placementManager.getBuildingMatrix();
		while (this.roomPlan.canPlaceMore('tower')) {
			const newTowers = [];

			this.scoreRampartPositions(ramparts);
			this.scoreTowerPositions(positions, ramparts);
			while(newTowers.length < this.roomPlan.remainingStructureCount('tower')) {
				let info = _.max(positions, 'score');
				if (!info || typeof info === 'number' || info.score < 0) break;

				info.score = -1;

				// Make sure it's possible to refill this tower.
				if (!this.placementManager.isPositionAccessible(info.pos, true)) continue;

				// Add tentative tower location.
				newTowers.push(info.pos);
				this.placementManager.planTemporaryLocation(info.pos, 'tower');

				if (newTowers.length < this.roomPlan.remainingStructureCount('tower')) {
					this.scoreRampartPositions(ramparts);
					this.scoreTowerPositions(positions, ramparts);
				}
			}

			// Abort if no towers can be placed.
			if (newTowers.length === 0) break;

			// Also create roads to all towers.
			for (const pos of newTowers) {
				// Check if access is still possible.
				if (!this.placementManager.isPositionAccessible(pos, true)) continue;

				this.placementManager.commitTemporaryLocation(pos, 'tower');
				// @todo Ensure tower access roads are completely behind walls.
				this.placementManager.placeAccessRoad(pos);
				this.placementManager.planLocation(pos, 'tower.' + (towerCount++));
			}

			// Restore building matrix values for subsequent operations.
			this.placementManager.discardTemporaryLocations('tower');
		}

		return 'ok';
	};

	/**
	 * Finds all positions where we might place towers within rampart protection.
	 *
	 * @return {array}
	 *   An array of objects with the following keys:
	 *   - score: The tower score for this position.
	 *   - pos: The position in question.
	 */
	findTowerPositions(): ScoredTowerPosition[] {
		const roomIntel = getRoomIntel(this.roomPlan.roomName);
		const safety = roomIntel.calculateAdjacentRoomSafety();
		const positions: ScoredTowerPosition[] = [];

		const allDirectionsSafe = _.sum(safety.directions) === 4;
		if (allDirectionsSafe) return positions;

		for (let x = 1; x < 49; x++) {
			for (let y = 1; y < 49; y++) {
				if (!this.placementManager.isBuildableTile(x, y)) continue;
				if (this.safetyMatrix.get(x, y) !== 1) continue;

				positions.push({
					score: 0,
					pos: new RoomPosition(x, y, this.roomPlan.roomName),
				});
			}
		}

		return positions;
	}

	/**
	 * Scores all available tower positions based on rampart tiles in range.
	 *
	 * Unprotected ramparts get higher priority than those already protected
	 * by another tower.
	 */
	scoreTowerPositions(positions: ScoredTowerPosition[], rampartPositions: ScoredTowerPosition[]) {
		for (const info of positions) {
			// Skip positions already considered for tower or road placement.
			if (!this.placementManager.isBuildableTile(info.pos.x, info.pos.y)) info.score = -1;
			if (info.score < 0) continue;

			let score = 0;

			// Add score for ramparts in range.
			for (const rampart of rampartPositions) {
				score += rampart.score * this.getTowerEffectScore(rampart.pos, info.pos.x, info.pos.y);
			}

			info.score = score;
		}
	}

	/**
	 * Finds the position of all ramparts in the room.
	 */
	findRampartPositions(): ScoredTowerPosition[] {
		const positions = [];

		for (const pos of this.roomPlan.getPositions('rampart')) {
			positions.push({
				score: 1,
				pos,
			});
		}

		return positions;
	}

	/**
	 * Calculates a weight for each rampart based on current protection level.
	 *
	 * The more towers in are in range of a rampart, the less important it is
	 * to add more protection near it.
	 */
	scoreRampartPositions(positions: ScoredTowerPosition[]) {
		for (const info of positions) {
			let rampartScore = 1;

			for (const pos of this.roomPlan.getPositions('tower')) {
				rampartScore *= 1 - 0.8 * this.getTowerEffectScore(pos, info.pos.x, info.pos.y);
			}
			for (const pos of this.roomPlan.getPositions('tower_placeholder')) {
				rampartScore *= 1 - 0.8 * this.getTowerEffectScore(pos, info.pos.x, info.pos.y);
			}

			info.score = rampartScore;
		}
	}

	/**
	 * Determines tower efficiency by range.
	 *
	 * @return {number}
	 *   Between 0 for least efficient and 1 for highest efficiency.
	 */
	getTowerEffectScore(pos: RoomPosition, x: number, y: number): number {
		const effectiveRange = Math.min(Math.max(pos.getRangeTo(x, y) + 2, TOWER_OPTIMAL_RANGE), TOWER_FALLOFF_RANGE);
		return 1 - ((effectiveRange - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE));
	}
}
