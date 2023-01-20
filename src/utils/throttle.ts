
declare global {
  interface Memory {
    throttleInfo: {
      bucket: {
        normal: number;
        warning: number;
        critical: number;
      };
    };
  }

  interface CreepHeapMemory {
    _tO?: number;
  }
}

const throttleNumbers = [];
let throttleOffset = 0;

/**
 * Choose whether an operation should currently run based on priorities.
 *
 * @param {number} offset
 *   Offset to add to time, so not all operations get throttled on the same tick.
 * @param {number} minBucket
 *   Minimum amount of bucket needed for this operation to run.
 * @param {number} maxBucket
 *   Amount of bucket at which this operation should always run.
 *
 * @return {boolean}
 *   True if the operation is allowed to run.
 */
function throttle(offset: number, minBucket?: number, maxBucket?: number) {
  initThrottleMemory();

  if (!offset) offset = 0;
  if (!minBucket) minBucket = Memory.throttleInfo.bucket.critical;
  if (!maxBucket) maxBucket = Memory.throttleInfo.bucket.normal;

  const bucket = Game.cpu.bucket;
  if (bucket >= maxBucket) return false;
  if (bucket < minBucket) return true;

  const tick = (Game.time + offset) % throttleNumbers.length;
  const ratio = (bucket - minBucket) / (maxBucket - minBucket);

  if (ratio >= throttleNumbers[tick]) return false;

  return true;
}

/**
 * Gets a new offset for a throttled operation.
 *
 * @return {number}
 *   Offset to store for a throttled operation.
 */
function getThrottleOffset(): number {
  return throttleOffset++;
}

/**
 * Initializes memory with general throttling information.
 */
function initThrottleMemory(): void {
  if (!Memory.throttleInfo) {
    Memory.throttleInfo = {
      bucket: {
        normal: 8000,
        warning: 5000,
        critical: 2000,
      },
    };
  }

  if (throttleNumbers.length === 0) {
    const sequence = generateEvenSequence(8, 2);
    const max = sequence[0];

    _.each(sequence, (number, index) => {
      throttleNumbers[index] = 1 - (number / max);
    });

    throttleNumbers[0] = 1;
  }
}

/**
 * Generates a Van der Corput sequence.
 *
 * @param {number} power
 *   Number of "digits" relative to base to generate a sequence for.
 * @param {number} base
 *   Base for the sequence. Detemines spacing of the sequence.
 *
 * @return {number[]}
 *   The generated sequence, containing all numbers from 1 to base^power.
 */
function generateEvenSequence(power: number, base: number): number[] {
  const numbers: number[] = [];
  const digits: number[] = [];
  for (let i = 0; i < power; i++) {
    digits[i] = 0;
  }

  function increase(digit: number) {
    if (digit >= power) return;

    digits[digit]++;
    if (digits[digit] >= base) {
      digits[digit] = 0;
      increase(digit + 1);
    }
  }

  function getNumber() {
    let sum = 0;
    for (let i = 0; i < power; i++) {
      sum *= base;
      sum += digits[i];
    }

    return sum;
  }

  increase(0);
  let number = getNumber();
  const max = number * base;
  numbers.push(max);
  while (number !== 0) {
    numbers.push(number);
    increase(0);
    number = getNumber();
  }

  return numbers;
}

export {
  throttle,
  getThrottleOffset,
}
