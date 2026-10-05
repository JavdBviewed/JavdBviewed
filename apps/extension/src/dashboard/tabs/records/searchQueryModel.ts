export interface RecordsSearchTokens {
  text: string;
  tags: string[];
  listIds: string[];
  listNames: string[];
  seriesIds: string[];
  labelPrefixes: string[];
  makerIds: string[];
  directorIds: string[];
}

const splitMultiTokenValue = (value: string): string[] =>
  value.split(/[，,;；]/).map((item) => item.trim()).filter(Boolean);

export function parseRecordsSearchTokens(raw: string): RecordsSearchTokens {
  const parts = (raw || '').split(/\s+/).filter(Boolean);
  const tags: string[] = [];
  const listIds: string[] = [];
  const listNames: string[] = [];
  const seriesIds: string[] = [];
  const labelPrefixes: string[] = [];
  const makerIds: string[] = [];
  const directorIds: string[] = [];
  const remains: string[] = [];

  for (const part of parts) {
    if (/^#/.test(part)) {
      const tag = part.replace(/^#/, '').trim();
      if (tag) tags.push(...splitMultiTokenValue(tag));
      continue;
    }
    if (/^tags?:/i.test(part)) {
      const tag = part.replace(/^tags?:/i, '').trim();
      if (tag) tags.push(...splitMultiTokenValue(tag));
      continue;
    }
    if (/^listid:/i.test(part)) {
      const listId = part.replace(/^listid:/i, '').trim();
      if (listId) listIds.push(...splitMultiTokenValue(listId));
      continue;
    }
    if (/^list:/i.test(part)) {
      const listName = part.replace(/^list:/i, '').trim();
      if (listName) listNames.push(...splitMultiTokenValue(listName));
      continue;
    }
    if (/^series:/i.test(part)) {
      const seriesId = part.replace(/^series:/i, '').trim();
      if (seriesId) seriesIds.push(...splitMultiTokenValue(seriesId));
      continue;
    }
    if (/^label:/i.test(part)) {
      const labelPrefix = part.replace(/^label:/i, '').trim();
      if (labelPrefix) labelPrefixes.push(...splitMultiTokenValue(labelPrefix).map((item) => item.toUpperCase()));
      continue;
    }
    if (/^maker:/i.test(part)) {
      const makerId = part.replace(/^maker:/i, '').trim();
      if (makerId) makerIds.push(...splitMultiTokenValue(makerId));
      continue;
    }
    if (/^director:/i.test(part)) {
      const directorId = part.replace(/^director:/i, '').trim();
      if (directorId) directorIds.push(...splitMultiTokenValue(directorId));
      continue;
    }
    remains.push(part);
  }

  return {
    text: remains.join(' ').trim(),
    tags,
    listIds,
    listNames,
    seriesIds,
    labelPrefixes,
    makerIds,
    directorIds,
  };
}

function removeMultiValueToken(raw: string, prefixPattern: RegExp, normalizedTarget: string, normalize: (value: string) => string): string {
  const parts = String(raw || '').split(/\s+/).filter(Boolean);
  const output: string[] = [];

  for (const part of parts) {
    if (prefixPattern.test(part)) {
      const prefix = part.match(prefixPattern)?.[0] || '';
      const value = part.replace(prefixPattern, '').trim();
      if (!value) continue;
      const remaining = splitMultiTokenValue(value).filter((item) => normalize(item) !== normalizedTarget);
      if (remaining.length > 0) output.push(`${prefix}${remaining.join(',')}`);
      continue;
    }
    output.push(part);
  }

  return output.join(' ').trim();
}

export function removeListIdTokenFromSearchInput(raw: string, listId: string): string {
  return removeMultiValueToken(raw, /^listid:/i, String(listId || '').toLowerCase(), (value) => String(value).toLowerCase());
}

export function removeSeriesTokenFromSearchInput(raw: string, seriesId: string): string {
  return removeMultiValueToken(raw, /^series:/i, String(seriesId || '').toLowerCase(), (value) => String(value).toLowerCase());
}

export function removeLabelTokenFromSearchInput(raw: string, labelId: string): string {
  return removeMultiValueToken(raw, /^label:/i, String(labelId || '').toUpperCase(), (value) => String(value).toUpperCase());
}

export function removeMakerTokenFromSearchInput(raw: string, makerId: string): string {
  return removeMultiValueToken(raw, /^maker:/i, String(makerId || '').toLowerCase(), (value) => String(value).toLowerCase());
}

export function removeDirectorTokenFromSearchInput(raw: string, directorId: string): string {
  return removeMultiValueToken(raw, /^director:/i, String(directorId || '').toLowerCase(), (value) => String(value).toLowerCase());
}
