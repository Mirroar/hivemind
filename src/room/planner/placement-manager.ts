import RoomPlan from 'room/planner/room-plan';
import {encodePosition, decodePosition} from 'utils/serialization';
import {handleMapArea} from 'utils/cost-matrix';

export default class PlacementManager {
  public readonly ROAD_POSITION = 1;
  public readonly DISCOURAGED_POSITION = 5;
  public readonly IMPASSABLE_POSITION = 255;
  public readonly ROAD_THROUGH_WALL_COST = 30;

  protected terrain: RoomTerrain;
  protected openList: {
    [location: string]: {
      range: number;
      path: {
        [location: string]: boolean;
      };
    };
  };
  protected closedList: {
    [location: string]: boolean;
  };
  protected currentBuildSpot: {
    pos: RoomPosition;
    info: {
      range: number;
      path: {
        [location: string]: boolean;
      };
    };
  };
  protected origin: RoomPosition;
  protected originEntrances: RoomPosition[];
  protected costMatrixBackup: {
    [location: string]: number,
  } = {};

  constructor(
    protected roomPlan: RoomPlan,
    protected buildingMatrix: CostMatrix,
    protected wallDistanceMatrix: CostMatrix,
    protected exitDistanceMatrix: CostMatrix,
  ) {
    this.terrain = new Room.Terrain(this.roomPlan.roomName);
    this.prepareBuildingMatrix();
  }

  /**
   * Prepares building cost matrix.
   */
  prepareBuildingMatrix() {
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) {
          this.buildingMatrix.set(x, y, this.ROAD_THROUGH_WALL_COST);
          continue;
        }

        // Treat border as unwalkable for in-room pathfinding.
        if (x === 0 || y === 0 || x === 49 || y === 49) {
          this.buildingMatrix.set(x, y, this.IMPASSABLE_POSITION);
          continue;
        }

        const wallDistance = this.wallDistanceMatrix.get(x, y);
        const exitDistance = this.exitDistanceMatrix.get(x, y);

        if (exitDistance <= 2) {
          // Avoid tiles we can't build ramparts on.
          this.buildingMatrix.set(x, y, this.DISCOURAGED_POSITION * 2);
        }
      }
    }
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
  planLocation(pos: RoomPosition, locationType: string, pathFindingCost?: number) {
    this.roomPlan.addPosition(locationType, pos);

    if (typeof pathFindingCost === 'undefined') {
      pathFindingCost = this.IMPASSABLE_POSITION;
    }

    if (pathFindingCost && this.buildingMatrix.get(pos.x, pos.y) < 100) {
      this.buildingMatrix.set(pos.x, pos.y, pathFindingCost);
    }
  }

  discouragePosition(x: number, y: number) {
    if (this.buildingMatrix.get(x, y) >= this.DISCOURAGED_POSITION || this.buildingMatrix.get(x, y) === this.ROAD_POSITION) return;

    this.buildingMatrix.set(x, y, this.DISCOURAGED_POSITION);
  }

  blockPosition(x: number, y: number) {
    this.buildingMatrix.set(x, y, this.IMPASSABLE_POSITION);
  }

  getWallDistance(x: number, y: number): number {
    return this.wallDistanceMatrix.get(x, y);
  }

  getExitDistance(x: number, y: number): number {
    return this.exitDistanceMatrix.get(x, y);
  }

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
    if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) return false;

    // Don't build too close to exits.
    if (this.exitDistanceMatrix.get(x, y) <= 5) return false;

    const matrixValue = this.buildingMatrix.get(x, y);
    // Can't build on other buildings.
    if (matrixValue > 100) return false;

    // Tiles next to walls are fine for building, just not so much for pathing.
    if (matrixValue === this.DISCOURAGED_POSITION && this.wallDistanceMatrix.get(x, y) <= 2) return true;

    // @todo Find out why this check was initially introduced.
    // Probably to not build close to exits.
    if (matrixValue > 1) return false;

    // Don't build on roads if not allowed.
    if (matrixValue === this.ROAD_POSITION && !allowRoads) return false;

    return true;
  };

  /**
   * Initializes pathfinding for finding building placement spots.
   */
  startBuildingPlacement(origin?: RoomPosition, originEntrances?: RoomPosition[]) {
    if (origin) this.origin = origin;
    if (originEntrances) this.originEntrances = originEntrances;

    // Flood fill from the center to place buildings that need to be accessible.
    this.openList = {};
    this.closedList = {};
    const startPath = {};
    startPath[encodePosition(this.origin)] = true;
    this.openList[encodePosition(this.origin)] = {
      range: 0,
      path: startPath,
    };
  }

  /**
   * Gets the next reasonable building placement location.
   *
   * @return {RoomPosition}
   *   A buildable spot.
   */
  getNextAvailableBuildSpot(): RoomPosition {
    while (_.size(this.openList) > 0) {
      let minDist = null;
      let nextPos = null;
      let nextInfo = null;
      _.each(this.openList, (info, posName) => {
        const pos = decodePosition(posName);
        if (!minDist || info.range < minDist) {
          minDist = info.range;
          nextPos = pos;
          nextInfo = info;
        }
      });

      if (!nextPos) break;

      delete this.openList[encodePosition(nextPos)];
      this.closedList[encodePosition(nextPos)] = true;

      // Add unhandled adjacent tiles to open list.
      handleMapArea(nextPos.x, nextPos.y, (x, y) => {
        if (x === nextPos.x && y === nextPos.y) return;
        if (!this.isBuildableTile(x, y, true)) return;

        const pos = new RoomPosition(x, y, this.roomPlan.roomName);
        const location = encodePosition(pos);
        if (this.openList[location] || this.closedList[location]) return;

        const newPath = {};
        for (const oldPos of _.keys(nextInfo.path)) {
          newPath[oldPos] = true;
        }

        newPath[location] = true;
        this.openList[location] = {
          range: minDist + 1,
          path: newPath,
        };
      });

      // Don't build to close to room center.
      if (nextPos.getRangeTo(this.origin) < 3) continue;

      // Don't build on roads.
      if (!this.isBuildableTile(nextPos.x, nextPos.y)) continue;

      this.currentBuildSpot = {
        pos: nextPos,
        info: nextInfo,
      };
      return nextPos;
    }

    return null;
  }

  /**
   * Removes all pathfinding options that use the given position.
   *
   * @param {string} targetPos
   *   An encoded room position that should not be used in paths anymore.
   */
  filterOpenList(targetPos: string) {
    for (const posName in this.openList) {
      if (this.openList[posName].path[targetPos]) {
        delete this.openList[posName];
      }
    }
  }

  /**
   * Gets information about the most recently requested build spot.
   *
   * @return {object}
   *   Info about the build spot, containing:
   *   - range: Distance from room center.
   *   - path: An object keyed by room positions that have been traversed.
   */
  getCurrentBuildSpotInfo() {
    return this.currentBuildSpot.info;
  }

  /**
   * Places all remaining structures of a given type.
   *
   * @param {string} structureType
   *   The type of structure to plan.
   * @param {boolean} addRoad
   *   Whether an access road should be added for these structures.
   */
  placeAll(structureType: StructureConstant, addRoad: boolean) {
    while (this.roomPlan.canPlaceMore(structureType)) {
      const nextPos = this.getNextAvailableBuildSpot();
      if (!nextPos) break;

      this.planLocation(new RoomPosition(nextPos.x, nextPos.y, this.roomPlan.roomName), structureType);
      this.filterOpenList(encodePosition(nextPos));

      if (addRoad) this.placeAccessRoad(nextPos);
    }
  }

  /**
   * Plans a road from the given position to the room's center.
   *
   * @param {RoomPosition} to
   *   Source position from which to start the road.
   */
  placeAccessRoad(to: RoomPosition) {
    // Plan road out of labs.
    const accessRoads = this.findAccessRoad(to, this.originEntrances);
    for (const pos of accessRoads) {
      this.planLocation(pos, 'road', 1);
    }
  }

  /**
   * Tries to create a road from a target point.
   *
   * @param {RoomPosition} from
   *   Position from where to start road creation. The position itself will not
   *   have a road built on it.
   * @param {RoomPosition|RoomPosition[]} to
   *   Position or positions to lead the road to.
   *
   * @return {RoomPosition[]}
   *   Positions that make up the newly created road.
   */
  findAccessRoad(from: RoomPosition, to: RoomPosition | RoomPosition[]): RoomPosition[] {
    const result = PathFinder.search(from, to, {
      roomCallback: () => this.buildingMatrix,
      maxRooms: 1,
      plainCost: 2,
      swampCost: 2, // Swamps are more expensive to build roads on, but once a road is on them, creeps travel at the same speed.
      heuristicWeight: 0.9,
    });

    if (!result.path) return [];

    const newRoads = [];
    for (const pos of result.path) {
      newRoads.push(pos);
    }

    return newRoads;
  }

  isPositionAccessible(pos: RoomPosition) {
    // We don't care about cost, just about possibility.
    const result = PathFinder.search(pos, this.originEntrances, {
      roomCallback: () => this.buildingMatrix,
      maxRooms: 1,
      plainCost: 1,
      swampCost: 1,
    });

    return !result.incomplete;
  }

  /**
   * Plans a room planner location of a certain type without fully committing.
   *
   * @param {RoomPosition} pos
   *   Position to plan the structure at.
   * @param {string} locationType
   *   Type of location to plan.
   * @param {number} pathFindingCost
   *   Value to set in the pathfinding costmatrix at this position (Default 255).
   */
  planTemporaryLocation(pos: RoomPosition, locationType: string, pathFindingCost?: number) {
    if (!this.costMatrixBackup[encodePosition(pos)]) {
      this.costMatrixBackup[encodePosition(pos)] = this.buildingMatrix.get(pos.x, pos.y);
    }

    this.planLocation(pos, locationType + '_placeholder', pathFindingCost);
  }

  commitTemporaryLocation(pos: RoomPosition, locationType: string) {
    delete this.costMatrixBackup[encodePosition(pos)];
    this.planLocation(pos, locationType, null);
    this.roomPlan.removePosition(locationType + '_placeholder', pos);
  }

  discardTemporaryLocations(locationType: string) {
    for (const position of this.roomPlan.getPositions(locationType + '_placeholder')) {
      delete this.costMatrixBackup[encodePosition(position)];
    }
    this.roomPlan.removeAllPositions(locationType + '_placeholder');
  }
}
