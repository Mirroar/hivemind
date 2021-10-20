declare global {
  type SerializedPlan = {
    [type: string]: string;
  };
}

type PositionCache = {
  [type: string]: {
    [coords: number]: RoomPosition;
  };
};

import {packCoordList, unpackCoordListAsPosList} from 'utils/packrat';
import utilities from 'utilities';

const structureSymbols = {
  container: '⊔',
  exit: '🚪',
  extension: '⚬',
  lab: '🔬',
  link: '🔗',
  nuker: '☢',
  observer: '👁',
  powerSpawn: '⚡',
  road: '·',
  spawn: '⭕',
  storage: '⬓',
  terminal: '⛋',
  tower: '⚔',
  wall: '▦',
};

export default class RoomPlan {
  roomName: string;
  version: number;
  positionsByType: PositionCache;

  constructor(roomName:string, version: number, input?: SerializedPlan) {
    this.roomName = roomName;
    this.version = version;
    this.positionsByType = {};
    if (input) this.unserialize(input);
  }

  serialize(): SerializedPlan {
    return _.mapValues(this.positionsByType, function (positions: {[coords: number]: RoomPosition}) {
      return packCoordList(_.values(positions));
    });
  }

  unserialize(input: SerializedPlan) {
    this.positionsByType = _.mapValues(input, function (posList: string): {[coords: number]: RoomPosition} {
      const positions = unpackCoordListAsPosList(posList, this.roomName);
      const cache: {
        [coords: number]: RoomPosition;
      } = {};

      for (const pos of positions) {
        const coord = utilities.serializeCoords(pos.x, pos.y);
        cache[coord] = pos;
      }

      return cache;
    }, this);
  }

  getVersion(): number {
    return this.version;
  }

  addPosition(type: string, pos: RoomPosition) {
    if (!this.positionsByType[type]) this.positionsByType[type] = {};

    this.positionsByType[type][utilities.serializeCoords(pos.x, pos.y)] = pos;
  }

  removePosition(type: string, pos: RoomPosition) {
    delete this.positionsByType[type][utilities.serializeCoords(pos.x, pos.y)];
  }

  removeAllPositions(type?: string) {
    if (type) {
      delete this.positionsByType[type];
      return;
    }

    this.positionsByType = {};
  }

  hasPosition(type: string, pos: RoomPosition): boolean {
    if (!this.positionsByType[type]) return false;

    return Boolean(this.positionsByType[type][utilities.serializeCoords(pos.x, pos.y)]);
  }

  getPositions(type: string): RoomPosition[] {
    return _.values(this.positionsByType[type]);
  }

  getPositionTypes(): string[] {
    return _.keys(this.positionsByType);
  }

  /**
   * Draws a simple representation of the room layout using RoomVisuals.
   */
  visualize() {
    const visual = new RoomVisual(this.roomName);
    for (const type in this.positionsByType) {
      if (!structureSymbols[type]) continue;

      const positions = this.positionsByType[type];
      for (const pos of _.values<RoomPosition>(positions)) {
        visual.text(structureSymbols[type], pos.x, pos.y + 0.2);
      }
    }

    for (const pos of _.values<RoomPosition>(this.positionsByType.rampart || [])) {
      visual.rect(pos.x - 0.5, pos.y - 0.5, 1, 1, {fill: '#0f0', opacity: 0.2});
    }
  }

}
