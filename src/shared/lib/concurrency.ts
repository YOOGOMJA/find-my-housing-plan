export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const workerCount = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;

      if (current >= items.length) {
        return;
      }

      results[current] = await mapper(items[current], current);
    }
  };

  const workers = Array.from({ length: Math.min(workerCount, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
