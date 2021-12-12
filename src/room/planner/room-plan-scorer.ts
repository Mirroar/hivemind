import RoomPlan from 'room/planner/room-plan';

export default class RoomPlanScorer {
  constructor (protected readonly roomName: string) {}

  getScore(plan: RoomPlan): number {
    let score = 0;

    score += this.getPlannedBuildingsScore(plan);
    score += this.getRequiredMaintenanceScore(plan);

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
}
