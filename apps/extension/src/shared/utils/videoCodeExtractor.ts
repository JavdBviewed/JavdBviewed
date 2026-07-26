/**
 * @file videoCodeExtractor.ts
 * @description 页面文本番号提取器 —— 从噪声文本中提取可复用番号候选
 * @module shared/utils
 */

export type VideoCodeKind = 'jav' | 'fc2' | 'numeric-dash' | 'uncensored' | 'unknown';

export interface ExtractedVideoCode {
  raw: string;
  normalized: string;
  display: string;
  kind: VideoCodeKind;
  index: number;
}

export interface ExtractVideoCodesOptions {
  allowStandaloneFc2Number?: boolean;
}

interface Candidate {
  raw: string;
  normalized: string;
  display: string;
  kind: VideoCodeKind;
  index: number;
  end: number;
  priority: number;
}

const GENERIC_PREFIXES = new Set(['THE', 'THIS', 'WHAT', 'WITH', 'MOVIE', 'VIDEO', 'SAMPLE']);

function compactSeparators(value: string): string {
  return String(value || '').trim().replace(/\s+/g, '');
}

function pushCandidate(candidates: Candidate[], candidate: Candidate): void {
  if (!candidate.normalized) return;
  candidates.push(candidate);
}

function normalizeStandardCode(prefix: string, number: string, suffix: string): string | null {
  const normalizedPrefix = prefix.toUpperCase();
  if (GENERIC_PREFIXES.has(normalizedPrefix)) return null;
  return `${normalizedPrefix}-${number}${suffix.toUpperCase()}`;
}

function addFc2Candidates(text: string, candidates: Candidate[]): void {
  const pattern = /(?<![A-Z0-9])FC2[-_\s]?(?:PPV[-_\s]?)?(\d{5,10})(?!\d)/gi;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const number = match[1];
    if (!number || match.index === undefined) continue;
    pushCandidate(candidates, {
      raw,
      normalized: `FC2-PPV-${number}`,
      display: `FC2-PPV-${number}`,
      kind: 'fc2',
      index: match.index,
      end: match.index + raw.length,
      priority: 10,
    });
  }
}

function addUncensoredCandidates(text: string, candidates: Candidate[]): void {
  const studioPattern = /(?<![A-Z0-9])([A-Z0-9]{1,12})[-_](\d{4,8})_(\d{1,3})(?![-_A-Z0-9])/gi;
  for (const match of text.matchAll(studioPattern)) {
    const raw = match[0];
    const prefix = match[1];
    const number = match[2];
    const episode = match[3];
    if (!prefix || !number || !episode || match.index === undefined) continue;
    pushCandidate(candidates, {
      raw,
      normalized: `${prefix.toUpperCase()}-${number}_${episode}`,
      display: `${prefix.toUpperCase()}-${number}_${episode}`,
      kind: 'uncensored',
      index: match.index,
      end: match.index + raw.length,
      priority: 20,
    });
  }

  const numericPattern = /(?<![A-Z0-9])(\d{4,8})_(\d{1,3})(?![-_A-Z0-9])/g;
  for (const match of text.matchAll(numericPattern)) {
    const raw = match[0];
    if (match.index === undefined) continue;
    pushCandidate(candidates, {
      raw,
      normalized: raw,
      display: raw,
      kind: 'uncensored',
      index: match.index,
      end: match.index + raw.length,
      priority: 25,
    });
  }
}

function addNumericDashCandidates(text: string, candidates: Candidate[]): void {
  const pattern = /(?<![A-Z0-9])(\d{4,8})-(\d{2,6})([A-Z]?)(?![-_A-Z0-9])/gi;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const first = match[1];
    const second = match[2];
    const suffix = match[3] || '';
    if (!first || !second || match.index === undefined) continue;
    pushCandidate(candidates, {
      raw,
      normalized: `${first}-${second}${suffix.toUpperCase()}`,
      display: `${first}-${second}${suffix.toUpperCase()}`,
      kind: 'numeric-dash',
      index: match.index,
      end: match.index + raw.length,
      priority: 30,
    });
  }
}

function addStandardCandidates(text: string, candidates: Candidate[]): void {
  const pattern = /(?<![A-Z0-9])([A-Z]{2,8})[-_]?(\d{2,6})([A-Z]{0,3})(?![-_A-Z0-9])/gi;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const prefix = match[1];
    const number = match[2];
    const suffix = match[3] || '';
    if (!prefix || !number || match.index === undefined) continue;
    const normalized = normalizeStandardCode(prefix, number, suffix);
    if (!normalized) continue;
    pushCandidate(candidates, {
      raw,
      normalized,
      display: normalized,
      kind: 'jav',
      index: match.index,
      end: match.index + raw.length,
      priority: 40,
    });
  }

  const mixedPrefixPattern = /(?<![A-Z0-9])([A-Z0-9]{2,10})[-_](\d{2,6})([A-Z]{0,3})(?![-_A-Z0-9])/gi;
  for (const match of text.matchAll(mixedPrefixPattern)) {
    const raw = match[0];
    const prefix = match[1];
    const number = match[2];
    const suffix = match[3] || '';
    if (!prefix || !number || match.index === undefined || !/[A-Z]/i.test(prefix) || !/\d/.test(prefix)) continue;
    const normalized = normalizeStandardCode(prefix, number, suffix);
    if (!normalized) continue;
    pushCandidate(candidates, {
      raw,
      normalized,
      display: normalized,
      kind: 'jav',
      index: match.index,
      end: match.index + raw.length,
      priority: 39,
    });
  }
}

function addStandaloneFc2NumberCandidates(text: string, candidates: Candidate[]): void {
  const pattern = /(?<![A-Z0-9])(\d{5,10})(?![-_A-Z0-9])/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const number = match[1];
    if (!number || match.index === undefined) continue;
    pushCandidate(candidates, {
      raw,
      normalized: `FC2-PPV-${number}`,
      display: raw,
      kind: 'fc2',
      index: match.index,
      end: match.index + raw.length,
      priority: 90,
    });
  }
}

function rangesOverlap(a: Candidate, b: Candidate): boolean {
  return a.index < b.end && b.index < a.end;
}

function selectCandidates(candidates: Candidate[]): ExtractedVideoCode[] {
  const ordered = [...candidates].sort((a, b) => {
    if (a.index !== b.index) return a.index - b.index;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return (b.end - b.index) - (a.end - a.index);
  });

  const selected: Candidate[] = [];
  const seenNormalized = new Set<string>();
  for (const candidate of ordered) {
    if (selected.some(item => rangesOverlap(item, candidate))) continue;
    if (seenNormalized.has(candidate.normalized)) continue;
    selected.push(candidate);
    seenNormalized.add(candidate.normalized);
  }

  return selected.map(({ raw, normalized, display, kind, index }) => ({
    raw,
    normalized,
    display,
    kind,
    index,
  }));
}

export function extractVideoCodesFromText(text: string, options: ExtractVideoCodesOptions = {}): ExtractedVideoCode[] {
  const source = String(text || '');
  if (!source.trim()) return [];

  const candidates: Candidate[] = [];
  addFc2Candidates(source, candidates);
  addUncensoredCandidates(source, candidates);
  addNumericDashCandidates(source, candidates);
  addStandardCandidates(source, candidates);
  if (options.allowStandaloneFc2Number === true) {
    addStandaloneFc2NumberCandidates(source, candidates);
  }

  return selectCandidates(candidates);
}

export function getFirstVideoCodeFromText(text: string, options: ExtractVideoCodesOptions = {}): ExtractedVideoCode | null {
  return extractVideoCodesFromText(text, options)[0] || null;
}

export function normalizeVideoCodeCandidate(value: string, options: ExtractVideoCodesOptions = { allowStandaloneFc2Number: true }): string | null {
  const compact = compactSeparators(value);
  const direct = getFirstVideoCodeFromText(compact, options);
  if (direct) return direct.normalized;

  const text = String(value || '').trim();
  if (!text) return null;
  const firstToken = text.match(/^([a-z0-9][a-z0-9_-]{2,24})/i)?.[1];
  if (!firstToken || !/\d/.test(firstToken)) return null;
  return getFirstVideoCodeFromText(firstToken, options)?.normalized || null;
}
