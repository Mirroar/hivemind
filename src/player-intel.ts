import hivemind from 'hivemind';

export type PlayerIntelMemory = {
  lastSeen: number;
  rooms: string[];
  remotes: string[];
}

export default class PlayerIntel {
  protected memory: PlayerIntelMemory;

  constructor(readonly userName: string) {
    const key = 'u-intel:' + userName;
    if (!hivemind.segmentMemory.has(key)) {
      hivemind.segmentMemory.set(key, {
        lastSeen: Game.time,
        rooms: [],
        remotes: [],
      });
    }

    this.memory = hivemind.segmentMemory.get(key);
  }

  isNpc(): boolean {
    return this.userName === SYSTEM_USERNAME || this.userName === 'Invader';
  }

  setPlayerRooms(rooms: string[]) {
    this.memory.rooms = rooms;
  }

  getAllPlayerRooms(): string[] {
    return this.memory.rooms;
  }

  setPlayerRemotes(rooms: string[]) {
    this.memory.remotes = rooms;
  }

  getAllPlayerRemotes(): string[] {
    return this.memory.remotes;
  }
}
