import hivemind from "hivemind";

class PersistentFeatureFlag<FlagOption extends string> {
    memory: Partial<Record<FlagOption, boolean | number>>;

    constructor(private memoryKey: string) {
        if (!hivemind.segmentMemory.isReady()) {
            throw new Error("Segment memory is not ready yet");
        }

        if (!hivemind.segmentMemory.has(this.memoryKey)) {
            hivemind.segmentMemory.set(this.memoryKey, {});
        }

        this.memory = hivemind.segmentMemory.get(this.memoryKey);
    }

    set(flag: FlagOption) {
        this.memory[flag] = true;
    }

    isSet(flag: FlagOption) {
        return this.memory[flag] === true;
    }

    setNumeric(flag: FlagOption, value: number) {
        this.memory[flag] = value;
    }

    getNumeric(flag: FlagOption) {
        return (this.memory[flag] ?? 0) as number;
    }

    unset(flag: FlagOption) {
        delete this.memory[flag];
    }

    reset() {
        this.memory = {};
        hivemind.segmentMemory.set(this.memoryKey, this.memory);
    }
}

export default PersistentFeatureFlag;