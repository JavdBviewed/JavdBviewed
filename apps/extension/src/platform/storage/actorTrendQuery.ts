type ActorTrendRow = {
  id?: string;
  createdAt?: number;
  updatedAt?: number;
  [key: string]: unknown;
};

type UpperBound = (value: number) => unknown;

export async function loadActorsForTrend(
  db: any,
  endMs: number,
  upperBound: UpperBound = (value) => IDBKeyRange.upperBound(value),
): Promise<ActorTrendRow[]> {
  const store = db.transaction('actors').store;
  const range = upperBound(endMs);
  const readIndex = async (name: string): Promise<ActorTrendRow[]> => {
    try {
      return await store.index(name).getAll(range);
    } catch {
      return [];
    }
  };

  const [createdRows, updatedRows] = await Promise.all([
    readIndex('by_createdAt'),
    readIndex('by_updatedAt'),
  ]);
  const rowsById = new Map<string, ActorTrendRow>();
  for (const row of [...createdRows, ...updatedRows]) {
    const id = String(row?.id || '');
    if (id) rowsById.set(id, row);
  }
  return Array.from(rowsById.values());
}
