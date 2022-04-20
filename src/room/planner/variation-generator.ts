import hivemind from 'hivemind';
import {getExitCenters} from 'utils/room-info';
import {getRoomIntel} from 'room-intel';

declare global {
  type VariationInfo = {
    roomCenter?: RoomPosition;
    sourcesWithSpawn?: Id<Source>[];
  }
}

export default class VariationGenerator {
  protected variations: {
    [kes: string]: VariationInfo;
  }
  protected variationKeys: string[];

  constructor(protected readonly roomName: string, protected wallDistanceMatrix: CostMatrix, protected exitDistanceMatrix: CostMatrix) {}

  generateVariations() {
    if (this.variations) return;

    this.variations = this.varyBy(null, variation => this.varyRoomCenter(variation));
    this.variations = this.varyBy(this.variations, variation => this.varySourceSpawns(variation));

    this.variationKeys = _.keys(this.variations);
  }

  varyBy(originalVariations: {[key: string]: VariationInfo}, callback: (variation: VariationInfo) => {[key: string]: VariationInfo}): {[key: string]: VariationInfo} {
    if (!originalVariations) return callback({});

    const variations = {};
    for (const key in originalVariations) {
      const modifiedVariations = callback(originalVariations[key]);

      for (const newSuffix in modifiedVariations) {
        variations[key + ':' + newSuffix] = modifiedVariations[newSuffix];
      }
    }

    return variations;
  }

  varyRoomCenter(baseVariation: VariationInfo): {[key: string]: VariationInfo} {
    const potentialCorePositions = this.collectPotentialCorePositions();

    const weightedCenterVariation = {
      ...baseVariation,
      roomCenter: this.chooseCorePosition(potentialCorePositions),
    };

    const variations = {'weighted': weightedCenterVariation};
    this.addGridCorePositions(variations, baseVariation, potentialCorePositions);

    return variations;
  }

  collectPotentialCorePositions(): RoomPosition[] {
    const terrain = new Room.Terrain(this.roomName);
    const potentialCorePositions: RoomPosition[] = [];

    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

        const wallDistance = this.wallDistanceMatrix.get(x, y);
        const exitDistance = this.exitDistanceMatrix.get(x, y);

        if (wallDistance >= 3 && wallDistance < 255 && exitDistance > 8) {
          potentialCorePositions.push(new RoomPosition(x, y, this.roomName));
        }
      }
    }

    return potentialCorePositions;
  }

  chooseCorePosition(potentialCorePositions: RoomPosition[]) {
    const roomIntel = getRoomIntel(this.roomName);
    const controllerPosition = roomIntel.getControllerPosition();
    const exitCenters = getExitCenters(this.roomName);

    // Decide where room center should be by averaging exit positions.
    // @todo Try multiple room centers:
    // - Current version
    // - Near controller
    // - Between controller and a source
    // - Near any corner or side
    // @todo Then evaluate best result by:
    // - Upkeep costs (roads, ramparts)
    // - Path lengths (Bays, sources, controller)
    let cx = controllerPosition.x;
    let cy = controllerPosition.y;
    let count = 1;
    for (const dir of _.keys(exitCenters)) {
      for (const pos of exitCenters[dir]) {
        count++;
        cx += pos.x;
        cy += pos.y;
      }
    }
    // Also include source and mineral positions when determining room center.
    const mineralInfo = roomIntel.getMineralPosition();
    if (mineralInfo) {
      count++;
      cx += mineralInfo.x;
      cy += mineralInfo.y;
    }

    const sourceInfo = roomIntel.getSourcePositions();
    for (const source of sourceInfo) {
      count++;
      cx += source.x;
      cy += source.y;
    }

    cx = Math.floor(cx / count);
    cy = Math.floor(cy / count);

    // Find closest position with distance from walls around there.
    const roomCenter = _.min(potentialCorePositions, p => p.getRangeTo(cx, cy));
    if (!roomCenter || (typeof roomCenter === 'number')) {
      hivemind.log('rooms', this.roomName).error('Could not find a suitable center position!');
      return null;
    }

    return roomCenter;
  }

  addGridCorePositions(variations: {[key: string]: VariationInfo}, baseVariation: VariationInfo, potentialCorePositions: RoomPosition[]) {
    const subdivisionCount = 3;
    const bestOptions: {
      [subDivision: string]: {
        distance: number;
        position: RoomPosition;
      };
    } = {};

    for (const position of potentialCorePositions) {
      const subDivision = Math.floor(position.x * subdivisionCount / 50) + 'x' + Math.floor(position.y * subdivisionCount / 50);

      if (!bestOptions[subDivision] || bestOptions[subDivision].distance < this.wallDistanceMatrix.get(position.x, position.y)) {
        bestOptions[subDivision] = {
          distance: this.wallDistanceMatrix.get(position.x, position.y),
          position,
        }
      }
    }

    for (const subDivision in bestOptions) {
      variations[subDivision] = {
        ...baseVariation,
        roomCenter: bestOptions[subDivision].position,
      }
    }
  }

  varySourceSpawns(baseVariation: VariationInfo): {[key: string]: VariationInfo} {
    const roomIntel = getRoomIntel(this.roomName);
    const sources = roomIntel.getSourcePositions();

    let currentVariations: {[key: string]: VariationInfo} = {
      '': {...baseVariation, sourcesWithSpawn: []},
    };

    for (const source of sources) {
      const modifiedVariations: {[key: string]: VariationInfo} = {};
      for (const key in currentVariations) {
        const withNewSource = [...currentVariations[key].sourcesWithSpawn];
        withNewSource.push(source.id);

        modifiedVariations[key + '-'] = {
          ...currentVariations[key],
        };
        modifiedVariations[key + '+'] = {
          ...currentVariations[key],
          sourcesWithSpawn: withNewSource,
        };
      }

      currentVariations = modifiedVariations;
    }

    return currentVariations;
  }

  getVariationList(): string[] {
    this.generateVariations();
    return this.variationKeys;
  }

  getVariationAmount(): number {
    this.generateVariations();
    return this.variationKeys.length;
  }

  getVariationInfo(key: string) {
    return this.variations[key];
  }
}
