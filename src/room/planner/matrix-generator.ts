import utilities from 'utilities';

export default class RoomPlanMatrixGenerator {
  terrain: RoomTerrain;

  generate(roomName: string): CostMatrix[] {
    const wallMatrix = new PathFinder.CostMatrix();
    const exitMatrix = new PathFinder.CostMatrix();
    this.terrain = new Room.Terrain(roomName);

    this.prepareDistanceMatrixes(wallMatrix, exitMatrix);

    this.propagateDistanceValues(wallMatrix);
    this.propagateDistanceValues(exitMatrix);

    return [wallMatrix, exitMatrix];
  }

  /**
   * Initializes wall and exit distance matrix with walls and adjacent tiles.
   *
   * @param {PathFinder.CostMatrix} wallMatrix
   *   Matrix that will have a 1 next to every wall tile.
   * @param {PathFinder.CostMatrix} exitMatrix
   *   Matrix that will have a 1 at every exit tile.
   */
  prepareDistanceMatrixes(wallMatrix: CostMatrix, exitMatrix: CostMatrix) {
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        if (this.terrain.get(x, y) === TERRAIN_MASK_WALL) {
          wallMatrix.set(x, y, 255);
          exitMatrix.set(x, y, 255);
          continue;
        }

        if (x === 0 || x === 49 || y === 0 || y === 49) {
          exitMatrix.set(x, y, 1);
        }

        this.markWallAdjacentTiles(wallMatrix, x, y);
      }
    }
  };

  /**
   * Sets a tile's value to 1 if it is next to a wall.
   *
   * @param {PathFinder.CostMatrix} matrix
   *   The matrix to modify.
   * @param {number} x
   *   x position of the tile in question.
   * @param {number} y
   *   y position of the tile in question.
   */
  markWallAdjacentTiles(matrix: CostMatrix, x: number, y: number) {
    utilities.handleMapArea(x, y, (ax, ay) => {
      if (this.terrain.get(ax, ay) === TERRAIN_MASK_WALL) {
        matrix.set(x, y, 1);
        return false;
      }

      return true;
    });
  };

  /**
   * Tries to fill all 0 values in the cost matrix with distance to nearest 1.
   *
   * @param {PathFinder.CostMatrix} matrix
   *   The cost matrix to modify.
   */
  propagateDistanceValues(matrix: CostMatrix) {
    // @todo Use some kind of flood fill to calculate these faster.
    let currentDistance = 1;
    let done = false;
    while (!done) {
      done = true;

      for (let x = 0; x < 50; x++) {
        for (let y = 0; y < 50; y++) {
          if (this.markDistanceTiles(matrix, currentDistance, x, y)) done = false;
        }
      }

      currentDistance++;
    }
  }

  /**
   * Sets a tile's value if it is 0 and has a tile value of distance adjacent.
   *
   * @param {PathFinder.CostMatrix} matrix
   *   The matrix to modify.
   * @param {number} distance
   *   Distance value to look for in adjacent tiles.
   * @param {number} x
   *   x position of the tile in question.
   * @param {number} y
   *   y position of the tile in question.
   *
   * @return {boolean}
   *   True if tile value was modified.
   */
  markDistanceTiles(matrix: CostMatrix, distance: number, x: number, y: number): boolean {
    if (matrix.get(x, y) !== 0) return false;

    let modified = false;
    utilities.handleMapArea(x, y, (ax, ay) => {
      if (matrix.get(ax, ay) === distance) {
        matrix.set(x, y, distance + 1);
        modified = true;
        return false;
      }

      return true;
    });

    return modified;
  };
}
