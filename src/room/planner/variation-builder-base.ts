import hivemind from 'hivemind';
import RoomPlan from 'room/planner/room-plan';
import utilities from 'utilities';

declare global {
  type StepResult = 'ok' | 'failed' | 'done';
}

export default class RoomVariationBuilderBase {
  roomName: string;
  variation: string;
  currentStep: number;
  roomPlan: RoomPlan;
  terrain: RoomTerrain;
  wallDistanceMatrix: CostMatrix;
  exitDistanceMatrix: CostMatrix;
  buildingMatrix: CostMatrix;
  finished: boolean;
  minCutBounds: MinCutRect[];

  readonly MAX_ROOM_LEVEL = 8;

  setWallMatrix(wallMatrix: CostMatrix) {
    this.wallDistanceMatrix = wallMatrix;
  }

  setExitMatrix(exitMatrix: CostMatrix) {
    this.exitDistanceMatrix = exitMatrix;
  }

  getRoomPlan(): RoomPlan {
    return this.roomPlan;
  }

  constructor(roomName: string, variation: string) {
    this.roomName = roomName;
    this.variation = variation;
    this.currentStep = 0;
    this.finished = false;
    this.roomPlan = new RoomPlan(this.roomName);
    this.terrain = new Room.Terrain(this.roomName);
    this.minCutBounds = [];
  }

  buildNextStep() {
    // @todo Provide a mechanism by which any step may abort the calculation.

    const start = Game.cpu.getUsed();
    const stepResult = this.buildStep(this.currentStep++);
    const end = Game.cpu.getUsed();
    hivemind.log('rooms', this.roomName).info('Planning took', end - start, 'CPU');

    // @todo Handle 'failed'.

    if (stepResult === 'done') {
      this.finished = true;
      hivemind.log('rooms', this.roomName).info('Finished room planning: ', utilities.renderCostMatrix(this.buildingMatrix));
    }
  }

  buildStep(step: number): StepResult {
    return 'done';
  }

  placeBayStructures(bayPosition: RoomPosition, options: {spawn?: boolean; source?: boolean} = {}) {
    if (this.canPlaceMore('spawn') && options.spawn) {
      utilities.handleMapArea(bayPosition.x, bayPosition.y, (x, y) => {
        if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return true;
        if (!this.isBuildableTile(x, y)) return true;
        if (x === bayPosition.x && y === bayPosition.y) return true;

        // Only place spawn where a road tile is adjacent, so creeps can
        // actually exit when a harvester is on its spot.
        let spawnPlaced = false;
        utilities.handleMapArea(x, y, (x2, y2) => {
          if (x2 == bayPosition.x && y2 == bayPosition.y) return true;
          if (this.buildingMatrix.get(x2, y2) !== 1) return true;

          this.placeFlag(new RoomPosition(x, y, this.roomName), 'spawn');
          spawnPlaced = true;
          return false;
        });

        if (spawnPlaced) return false;

        return true;
      });
    }

    let linkPlaced = !this.canPlaceMore('link') || !options.source;
    utilities.handleMapArea(bayPosition.x, bayPosition.y, (x, y) => {
      if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return;
      if (!this.isBuildableTile(x, y)) return;
      if (x === bayPosition.x && y === bayPosition.y) return;

      if (linkPlaced) {
        this.placeFlag(new RoomPosition(x, y, this.roomName), 'extension');
        if (options.source) {
          this.placeFlag(new RoomPosition(x, y, this.roomName), 'extension.harvester');
        }
        else {
          this.placeFlag(new RoomPosition(x, y, this.roomName), 'extension.bay');
        }
      }
      else {
        this.placeFlag(new RoomPosition(x, y, this.roomName), 'link');
        if (options.source) {
          this.placeFlag(new RoomPosition(x, y, this.roomName), 'link.source');
        }
        linkPlaced = true;
      }
    });
  }

  /**
   * Places a link near a given road.
   *
   * @param {RoomPosition[]} sourceRoads
   *   Positions that make up the road.
   * @param {string} linkType
   *   Type identifier for this link, like `source` or `controller`.
   */
  placeLink(sourceRoads: RoomPosition[], linkType: string) {
    const targetPos = this.findLinkPosition(sourceRoads);

    if (!targetPos) return;

    if (linkType) {
      this.placeFlag(targetPos, 'link.' + linkType, null);
    }

    this.placeFlag(targetPos, 'link');
  };

  /**
   * Finds a spot for a link near a given road.
   *
   * @param {RoomPosition[]} sourceRoads
   *   Positions that make up the road.
   *
   * @return {RoomPosition}
   *   A Position at which a container can be placed.
   */
  findLinkPosition(sourceRoads: RoomPosition[]): RoomPosition {
    for (const pos of _.slice(sourceRoads, 0, 3)) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (this.isBuildableTile(pos.x + dx, pos.y + dy)) {
            return new RoomPosition(pos.x + dx, pos.y + dy, pos.roomName);
          }
        }
      }
    }

    return null;
  };

  /**
   * Places a container near a given road.
   *
   * @param {RoomPosition[]} sourceRoads
   *   Positions that make up the road.
   * @param {string} containerType
   *   Type identifier for this container, like `source` or `controller`.
   */
  placeContainer(sourceRoads: RoomPosition[], containerType: string) {
    const targetPos = this.findContainerPosition(sourceRoads);

    if (!targetPos) return;

    if (containerType) {
      this.placeFlag(targetPos, 'container.' + containerType, null);
    }

    this.placeFlag(targetPos, 'container', 1);
  };

  /**
   * Finds a spot for a container near a given road.
   *
   * @param {RoomPosition[]} sourceRoads
   *   Positions that make up the road.
   *
   * @return {RoomPosition}
   *   A Position at which a container can be placed.
   */
  findContainerPosition(sourceRoads: RoomPosition[]): RoomPosition {
    if (this.isBuildableTile(sourceRoads[0].x, sourceRoads[0].y, true)) {
      return sourceRoads[0];
    }

    if (this.isBuildableTile(sourceRoads[1].x, sourceRoads[1].y, true)) {
      return sourceRoads[1];
    }

    let targetPosition: RoomPosition;
    for (const pos of _.slice(sourceRoads, 0, 3)) {
      utilities.handleMapArea(pos.x, pos.y, (x, y) => {
        if (this.isBuildableTile(x, y, true)) {
          targetPosition = new RoomPosition(x, y, pos.roomName);
          return false;
        }

        return true;
      });
    }

    return targetPosition;
  };

  /**
   * Plans a room planner location of a certain type.
   *
   * @param {RoomPosition} pos
   *   Position to plan the structure at.
   * @param {string} locationType
   *   Type of location to plan.
   * @param {number} pathFindingCost
   *   Value to set in the pathfinding costmatrix at this position (Default 255).
   */
  placeFlag(pos: RoomPosition, locationType: string, pathFindingCost?: number) {
    this.roomPlan.addPosition(locationType, pos);

    if (typeof pathFindingCost === 'undefined') {
      pathFindingCost = 255;
    }

    if (pathFindingCost && this.buildingMatrix.get(pos.x, pos.y) < 100) {
      this.buildingMatrix.set(pos.x, pos.y, pathFindingCost);
    }

    const baseType = locationType.split('.')[0];
    if (CONTROLLER_STRUCTURES[baseType] && ['extension', 'road', 'container', 'extractor'].indexOf(baseType) === -1) {
      // Protect area around essential structures.
      this.protectPosition(pos);
    }
    if (['road.source', 'road.controller'].indexOf(locationType) !== -1) {
      // Protect source and controller roads to prevent splitting room into
      // unconnected areas.
      this.protectPosition(pos, 0);
    }
  };

  /**
   * Adds a position to be protected by minCut.
   */
  protectPosition(pos: RoomPosition, distance?: number) {
    if (typeof distance === 'undefined') distance = hivemind.settings.get('minCutRampartDistance');
    const x1 = Math.max(2, pos.x - distance);
    const x2 = Math.min(47, pos.x + distance);
    const y1 = Math.max(2, pos.y - distance);
    const y2 = Math.min(47, pos.y + distance);
    this.minCutBounds.push({x1, x2, y1, y2});
  };

  /**
   * Checks if a structure can be placed on the given tile.
   *
   * @param {number} x
   *   x coordinate of the position to check.
   * @param {number} y
   *   y coordinate of the position to check.
   * @param {boolean} allowRoads
   *   Whether to allow building placement on a road.
   *
   * @return {boolean}
   *   True if building on the given coordinates is allowed.
   */
  isBuildableTile(x: number, y: number, allowRoads?: boolean): boolean {
    // Only build on valid terrain.
    if (this.wallDistanceMatrix.get(x, y) > 100) return false;

    // Don't build too close to exits.
    if (this.exitDistanceMatrix.get(x, y) < 6) return false;

    const matrixValue = this.buildingMatrix.get(x, y);
    // Can't build on other buildings.
    if (matrixValue > 100) return false;

    // Tiles next to walls are fine for building, just not so much for pathing.
    if (matrixValue === 10 && this.wallDistanceMatrix.get(x, y) < 3) return true;

    // @todo Find out why this check was initially introduced.
    if (matrixValue > 1) return false;

    // Don't build on roads if not allowed.
    if (matrixValue === 1 && !allowRoads) return false;

    return true;
  };

  /**
   * Determines whether more of a certain structure could be placed.
   *
   * @param {string} structureType
   *   The type of structure to check for.
   *
   * @return {boolean}
   *   True if the current controller level allows more of this structure.
   */
  canPlaceMore(structureType: StructureConstant): boolean {
    return this.remainingStructureCount(structureType) > 0;
  };

  /**
   * Determines the number of structures of a type that could be placed.
   *
   * @param {string} structureType
   *   The type of structure to check for.
   *
   * @return {number}
   *   The number of structures of the given type that may still be placed.
   */
  remainingStructureCount(structureType: StructureConstant): number {
    return CONTROLLER_STRUCTURES[structureType][this.MAX_ROOM_LEVEL] - _.size(this.roomPlan.getPositions(structureType) || []);
  }

}
