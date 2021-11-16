import RoomPlan from 'room/planner/room-plan';
import RoomPlanMatrixGenerator from 'room/planner/matrix-generator';
import RoomVariationBuilder from 'room/planner/variation-builder';

type HeapMemory = {
  plan: RoomPlan;
}

const generatorCache: {
  [roomName: string]: HeapMemory;
} = {};

export default class RoomPlanGenerator {
  roomName: string;
  variations: string[];
  variationIndex: number;
  currentVariation: string;
  wallMatrix: CostMatrix;
  exitMatrix: CostMatrix;
  variationBuilder: RoomVariationBuilder;
  results: {
    [variation: string]: {
      plan: RoomPlan;
      score: number;
    }
  };

  constructor(roomName: string, version: number) {
    this.roomName = roomName;
    this.variationIndex = 0;
    this.results = {};
    this.generateVariationList();
  }

  generate() {
    if (this.isFinished()) return;

    if (!this.currentVariation) {
      this.initVariation();
      return;
    }

    this.generateVariation();
  }

  isFinished(): boolean {
    return !this.currentVariation && this.variationIndex > this.variations.length;
  }

  generateVariationList() {
    this.variations = ['default'];
  }

  initVariation() {
    this.currentVariation = this.variations[this.variationIndex++];
    this.variationBuilder = new RoomVariationBuilder(this.roomName, this.currentVariation);
    this.provideDistanceMatrixes();
    this.variationBuilder.setWallMatrix(this.wallMatrix);
    this.variationBuilder.setExitMatrix(this.exitMatrix);
  }

  generateVariation() {
    if (!this.variationBuilder.isFinished()) {
      this.variationBuilder.buildNextStep();
      return;
    }

    this.finalizeVariation();
  }

  /**
   * Generates CostMatrixes needed for structure placement.
   */
  provideDistanceMatrixes() {
    // These matrixes are cached until room plan generation is finished.
    if (this.wallMatrix) return;

    [this.wallMatrix, this.exitMatrix] = new RoomPlanMatrixGenerator().generate(this.roomName);
  }

  finalizeVariation() {
    // @todo Store room plan for current variation and score it.
    const plan = this.variationBuilder.getRoomPlan();
    this.results[this.currentVariation] = {
      plan,
      score: this.getRoomPlanScore(plan),
    };

    delete this.variationBuilder;
    delete this.currentVariation;
  }

  getRoomPlanScore(plan: RoomPlan) {
    // @todo
    return 0;
  }

  getRoomPlan(): RoomPlan {
    // @todo Get room plan with highest score.
    const best = _.max(this.results, 'score');

    if (best) return best.plan;

    return null;
  }

  visualize() {
    if (this.variationBuilder) {
      const plan = this.variationBuilder.getRoomPlan();
      plan.visualize();
      return;
    }

    const plan = this.getRoomPlan();
    if (!plan) return;

    plan.visualize();
  }
}
