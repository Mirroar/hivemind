import hivemind from 'hivemind';

export default class PlayerIntel {
  protected memory: {};

  constructor(readonly userName: string) {
    const key = 'u-intel:' + userName;
    if (!hivemind.segmentMemory.has(key)) {
      hivemind.segmentMemory.set(key, {});
    }

    this.memory = hivemind.segmentMemory.get(key);
  }

  isNpc(): boolean {
    return this.userName === SYSTEM_USERNAME || this.userName === 'Invader';
  }
}
