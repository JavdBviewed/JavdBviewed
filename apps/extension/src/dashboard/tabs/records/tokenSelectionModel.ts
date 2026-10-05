import type { RecordsSearchTokens } from './searchQueryModel';

export interface SyncRecordsTokenSelectionsInput {
  parsedTokens: RecordsSearchTokens;
  selectedTags: Set<string>;
  tokenSelectedTags: Set<string>;
  selectedListIds: Set<string>;
  tokenSelectedListIds: Set<string>;
  selectedSeriesIds: Set<string>;
  tokenSelectedSeriesIds: Set<string>;
  selectedLabelIds: Set<string>;
  tokenSelectedLabelIds: Set<string>;
  selectedMakerIds: Set<string>;
  tokenSelectedMakerIds: Set<string>;
  selectedDirectorIds: Set<string>;
  tokenSelectedDirectorIds: Set<string>;
  listNameById: Map<string, string>;
}

export interface SyncRecordsTokenSelectionsResult {
  tokenSelectedTags: Set<string>;
  tokenSelectedListIds: Set<string>;
  tokenSelectedSeriesIds: Set<string>;
  tokenSelectedLabelIds: Set<string>;
  tokenSelectedMakerIds: Set<string>;
  tokenSelectedDirectorIds: Set<string>;
}

function replaceTokenSelections(target: Set<string>, previousTokens: Set<string>, nextTokens: Set<string>): void {
  previousTokens.forEach(token => target.delete(token));
  nextTokens.forEach(token => target.add(token));
}

function resolveListTokenIds(parsedTokens: RecordsSearchTokens, listNameById: Map<string, string>): Set<string> {
  const resolved = new Set<string>();
  (parsedTokens.listIds || []).forEach((id) => {
    if (id) resolved.add(String(id));
  });

  const nameTokens = (parsedTokens.listNames || [])
    .map(name => String(name).toLowerCase())
    .filter(Boolean);
  if (nameTokens.length === 0) return resolved;

  for (const [id, name] of listNameById.entries()) {
    const normalizedName = String(name || '').toLowerCase();
    if (nameTokens.some(token => normalizedName.includes(token))) {
      resolved.add(String(id));
    }
  }

  return resolved;
}

export function syncRecordsTokenSelections(
  input: SyncRecordsTokenSelectionsInput,
): SyncRecordsTokenSelectionsResult {
  const tokenSelectedTags = new Set(input.parsedTokens.tags);
  replaceTokenSelections(input.selectedTags, input.tokenSelectedTags, tokenSelectedTags);

  const tokenSelectedListIds = resolveListTokenIds(input.parsedTokens, input.listNameById);
  replaceTokenSelections(input.selectedListIds, input.tokenSelectedListIds, tokenSelectedListIds);

  const tokenSelectedSeriesIds = new Set(input.parsedTokens.seriesIds);
  replaceTokenSelections(input.selectedSeriesIds, input.tokenSelectedSeriesIds, tokenSelectedSeriesIds);

  const tokenSelectedLabelIds = new Set(input.parsedTokens.labelPrefixes);
  replaceTokenSelections(input.selectedLabelIds, input.tokenSelectedLabelIds, tokenSelectedLabelIds);

  const tokenSelectedMakerIds = new Set(input.parsedTokens.makerIds || []);
  replaceTokenSelections(input.selectedMakerIds, input.tokenSelectedMakerIds, tokenSelectedMakerIds);

  const tokenSelectedDirectorIds = new Set(input.parsedTokens.directorIds || []);
  replaceTokenSelections(input.selectedDirectorIds, input.tokenSelectedDirectorIds, tokenSelectedDirectorIds);

  return {
    tokenSelectedTags,
    tokenSelectedListIds,
    tokenSelectedSeriesIds,
    tokenSelectedLabelIds,
    tokenSelectedMakerIds,
    tokenSelectedDirectorIds,
  };
}
