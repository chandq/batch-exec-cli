/**
 * Ordered worker pool: run task thunks with at most `limit` in flight, writing
 * each result back by index so results stay in input order regardless of
 * completion order.
 *
 * A `limit` of 0/undefined keeps the historical unbounded fan-out
 * (`Promise.all` over every task at once). A task that throws rejects this
 * promise; the other in-flight tasks are not cancelled - they are already
 * running - and are left to settle.
 */
export async function runWithConcurrency(tasks, limit) {
  if (!limit || limit < 1) {
    return Promise.all(tasks.map(task => task()));
  }

  const results = new Array(tasks.length);
  let next = 0;

  const worker = async () => {
    while (next < tasks.length) {
      // No await between reading and advancing, so the index hand-out is safe
      // on a single-threaded event loop.
      const index = next++;
      results[index] = await tasks[index]();
    }
  };

  const workers = Math.min(limit, tasks.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

/**
 * Effective parallelism for a run: an explicit `--concurrency` wins, otherwise
 * every directory is started at once (0 = unlimited).
 *
 * The default is unlimited on every platform, Windows included. Capping it by
 * CPU count was tried and measured slower there - dramatically so (minutes over
 * a large directory set), because spawning a shell on Windows is latency-bound
 * rather than CPU-bound: process creation is 10-50x costlier than on Unix and
 * AV real-time scanning serializes it. Leaving the fan-out to the OS overlaps
 * that latency instead of queueing behind it, which is why the cap was removed
 * rather than tuned. Raising the limit is still available (`--concurrency <n>`)
 * for anyone whose child processes are heavy enough to need it.
 *
 * `??` rather than `||` is load-bearing - 0 is a meaningful request, not an
 * absent value.
 */
export function resolveConcurrency(requested) {
  return requested ?? 0;
}
