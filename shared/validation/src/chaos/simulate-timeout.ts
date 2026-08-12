/**
 * Chaos-testing helper: wraps an async call and simulates it hanging
 * past a deadline, to verify callers (orchestrator, web-ui backend)
 * handle sub-MCP timeouts gracefully instead of hanging forever.
 */

export class SimulatedTimeoutError extends Error {
  constructor(afterMs: number) {
    super(`Simulated timeout after ${afterMs}ms`);
    this.name = "SimulatedTimeoutError";
  }
}

export async function withSimulatedTimeout<T>(fn: () => Promise<T>, afterMs: number): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new SimulatedTimeoutError(afterMs)), afterMs);
    }),
  ]);
}

/**
 * Runs `fn` against a battery of timeout thresholds and reports which
 * ones the caller failed to handle (i.e. the promise never settled before
 * the process would consider it stuck). Intended for use from
 * ci-runner.ts against router.callSubServerTool once that has a real
 * transport wired up.
 */
export async function chaosTimeoutSweep<T>(
  fn: () => Promise<T>,
  thresholdsMs: number[] = [50, 200, 1000]
): Promise<{ thresholdMs: number; timedOut: boolean }[]> {
  const results: { thresholdMs: number; timedOut: boolean }[] = [];
  for (const thresholdMs of thresholdsMs) {
    try {
      await withSimulatedTimeout(fn, thresholdMs);
      results.push({ thresholdMs, timedOut: false });
    } catch (err) {
      results.push({ thresholdMs, timedOut: err instanceof SimulatedTimeoutError });
    }
  }
  return results;
}
