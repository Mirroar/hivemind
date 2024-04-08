interface Memory {
  profiler: ProfilerMemory;
}

interface ProfilerMemory {
  data: { [name: string]: ProfilerData };
  start?: number;
  total: number;
}

interface ProfilerData {
  calls: number;
  time: number;
}

interface Profiler {
  clear(): string;
  output(): string;
  start(): string;
  status(): string;
  stop(): string;
  toString(): string;
}

declare const __PROFILER_ENABLED__: boolean;
