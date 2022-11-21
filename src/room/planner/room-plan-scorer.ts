import RoomPlan from 'room/planner/room-plan';
import {getRoomIntel} from 'room-intel';

export default class RoomPlanScorer {
	constructor(protected readonly roomName: string) {}

	getScore(plan: RoomPlan, exitMatrix?: CostMatrix, wallMatrix?: CostMatrix): Record<string, number> {
		const score: Record<string, number> = {};

		score.structures = this.getPlannedBuildingsScore(plan);
		score.maintenance = this.getRequiredMaintenanceScore(plan);
		score.towers = this.getAverageTowerScore(plan);
    score.defense = this.getDefensibilityScore(plan, exitMatrix);
		score.distance = this.getTravelDistancesScore(plan);

		// @todo Score unprotected structures.
		// @todo Score susceptibility to nukes.

		score.total = _.sum(score);

		return score;
	}

  getPlannedBuildingsScore(plan: RoomPlan): number {
    let score = 0;

    score += 0.01 * this.getPlannedAmount(plan, STRUCTURE_EXTENSION);
    score += 0.01 * this.getPlannedAmount(plan, STRUCTURE_FACTORY);
    score += 0.01 * this.getPlannedAmount(plan, STRUCTURE_OBSERVER);
    score += 0.02 * this.getPlannedAmount(plan, STRUCTURE_LAB);
    score += 0.02 * this.getPlannedAmount(plan, STRUCTURE_NUKER);
    score += 0.05 * this.getPlannedAmount(plan, STRUCTURE_EXTRACTOR);
    score += 0.05 * this.getPlannedAmount(plan, STRUCTURE_POWER_SPAWN);
    score += 0.1 * this.getPlannedAmount(plan, STRUCTURE_SPAWN);
    score += 0.2 * this.getPlannedAmount(plan, STRUCTURE_TERMINAL);
    score += 0.2 * this.getPlannedAmount(plan, STRUCTURE_TOWER);
    score += 1 * this.getPlannedAmount(plan, STRUCTURE_STORAGE);

    return score;
  }

  getPlannedAmount(plan: RoomPlan, structureType: StructureConstant) {
    return Math.min(plan.getPositions(structureType).length, CONTROLLER_STRUCTURES[structureType][8]);
  }

  getRequiredMaintenanceScore(plan: RoomPlan): number {
    let score = 0;

    score -= 0.001 * this.getPlannedAmount(plan, STRUCTURE_RAMPART) * RAMPART_DECAY_AMOUNT / RAMPART_DECAY_TIME;
    score -= 0.001 * this.getPlannedAmount(plan, STRUCTURE_CONTAINER) * CONTAINER_DECAY / CONTAINER_DECAY_TIME_OWNED;

    const terrain = new Room.Terrain(this.roomName);
    for (const position of plan.getPositions(STRUCTURE_ROAD)) {
      let factor = 0.002;
      if (terrain.get(position.x, position.y) === TERRAIN_MASK_SWAMP) factor *= CONSTRUCTION_COST_ROAD_SWAMP_RATIO;
      if (terrain.get(position.x, position.y) === TERRAIN_MASK_WALL) factor *= CONSTRUCTION_COST_ROAD_WALL_RATIO;

      score -= factor * ROAD_DECAY_AMOUNT / ROAD_DECAY_TIME;
    }

    return score;
  }

  getAverageTowerScore(plan: RoomPlan): number {
    const ramparts = plan.getPositions(STRUCTURE_RAMPART);
    const towers = plan.getPositions(STRUCTURE_TOWER);

    if (towers.length === 0 || ramparts.length === 0) return 0;

    let total = 0;
    for (const rampartPosition of ramparts) {
      for (const towerPosition of towers) {
        total += this.getTowerEffectScore(towerPosition, rampartPosition);
      }
    }

    return 0.2 * total / ramparts.length;
  }

  /**
   * Determines tower efficiency by range.
   *
   * @return {number}
   *   Between 0 for least efficient and 1 for highest efficiency.
   */
  getTowerEffectScore(pos: RoomPosition, otherPos: RoomPosition): number {
    const effectiveRange = Math.min(Math.max(pos.getRangeTo(otherPos) + 2, TOWER_OPTIMAL_RANGE), TOWER_FALLOFF_RANGE);
    return 1 - ((effectiveRange - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE));
  }

  getDefensibilityScore(plan: RoomPlan, exitMatrix?: CostMatrix): number {
    if (!exitMatrix) return 0;

    let total = 0;
    const ramparts = plan.getPositions(STRUCTURE_RAMPART);
    for (const rampartPosition of ramparts) {
      const exitDistance = exitMatrix.get(rampartPosition.x, rampartPosition.y);
      if (exitDistance < 6) total += (6 - exitDistance) * (6 - exitDistance);
    }

    return -0.003 * total;
  }

  getTravelDistancesScore(plan: RoomPlan): number {
    const matrix = plan.createNavigationMatrix();
    const roomIntel = getRoomIntel(this.roomName);

    let total = 0;

    // Travel time from spawn to harvest positions.
    const spawnGoals = _.map(
      plan.getPositions(STRUCTURE_SPAWN),
      spawnPosition => {return {pos: spawnPosition, range: 1};}
    );
    total -= 0.003 * _.sum(_.map(
      plan.getPositions('harvester'),
      harvestPosition => this.getPathLength(harvestPosition, spawnGoals, matrix)
    ));

    // Travel time from spawn to upgrader position.
    // @todo Use position from room planner once we switch to range 3 from
    // controller.
    total -= 0.002 * this.getPathLength(roomIntel.getControllerPosition(), spawnGoals, matrix);

    // Travel time from spawn to extractor.
    const mineralInfo = roomIntel.getMineralPosition();
    const mineralPosition = new RoomPosition(mineralInfo.x, mineralInfo.y, this.roomName);
    total -= 0.001 * this.getPathLength(mineralPosition, spawnGoals, matrix);

    // @todo Refill travel time from storage to bays.
    const roomCenter = _.sample(plan.getPositions('center')) || _.sample(plan.getPositions(STRUCTURE_STORAGE));

    // @todo Refill travel time from storage to spawns / extensions not in a bay.

    // Refill travel time from storage to towers.
    total -= 0.001 * _.sum(_.map(
      plan.getPositions('tower'),
      towerPosition => this.getPathLength(towerPosition, roomCenter, matrix)
    ));

    return total;
  }

  getPathLength(from: RoomPosition, to: RoomPosition | {pos: RoomPosition, range: number} | {pos: RoomPosition, range: number}[], matrix: CostMatrix): number {
    const result = PathFinder.search(from, to, {
      roomCallback: () => matrix,
      plainCost: 2,
      swampCost: 10,
      maxRooms: 1,
    });

    if (result.incomplete) return 1000;

    return result.path.length;
  }
}
