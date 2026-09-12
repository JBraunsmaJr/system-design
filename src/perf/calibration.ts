/**
 * Standardized standalone CPU benchmark.
 *
 * Runs a deterministic compute-heavy loop independent of the DOM or app code.
 * The resulting duration is used to normalize wall-clock timings across
 * different host machines and CI runner contention levels (PERF-M-3).
 */
export function runCpuCalibration(iterations: number = 2_000_000): number {
  const start = performance.now();
  let acc = 123456789;
  for (let i = 0; i < iterations; i++) {
    // Deterministic arithmetic operations
    acc = (acc ^ (acc << 13)) | 0;
    acc = (acc ^ (acc >>> 17)) | 0;
    acc = (acc ^ (acc << 5)) | 0;
    acc = (acc + Math.imul(i, 31)) | 0;
  }
  const duration = performance.now() - start;
  // Ensure optimizer doesn't eliminate loop
  if (acc === 0) {
    console.log("zero acc");
  }
  return Number(duration.toFixed(2));
}
