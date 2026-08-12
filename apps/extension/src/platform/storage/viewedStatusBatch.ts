const DEFAULT_VIEWED_STATUS_BATCH_SIZE = 64;

export function chunkViewedStatusIds(
  videoIds: readonly string[],
  batchSize = DEFAULT_VIEWED_STATUS_BATCH_SIZE,
): string[][] {
  const ids = [...new Set(videoIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const size = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : DEFAULT_VIEWED_STATUS_BATCH_SIZE;
  const batches: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += size) {
    batches.push(ids.slice(offset, offset + size));
  }
  return batches;
}
