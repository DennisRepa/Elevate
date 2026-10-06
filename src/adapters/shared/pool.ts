/**
 * Elevate — bounded concurrency helper.
 */

/**
 * Maps `items` through `fn` with at most `concurrency` calls in flight.
 * Results keep the input order. A rejected call rejects the whole pool, so
 * `fn` should handle expected failures itself.
 */
export async function mapPooled<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
