import { describe, it, expect } from 'vitest';
import {
  sortBibsNaturally,
  computeTimeTrialQueue,
  computeTimeTrialResults,
  getProgress,
} from './timeTrial';
import type { Entry, Crossing } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<Entry> & { bib: string; id: string }): Entry {
  return {
    race_id: 'r',
    name: 'Rider',
    team: null,
    category: null,
    status: 'ok',
    status_reason: null,
    status_set_by: null,
    status_set_at: null,
    ...overrides,
  };
}

function makeCrossing(
  bib: string,
  clientRecordedAt: string,
  overrides: Partial<Crossing> = {}
): Crossing {
  return {
    id: crypto.randomUUID(),
    race_id: 'r',
    bib,
    client_id: crypto.randomUUID(),
    recorded_at: clientRecordedAt,
    client_recorded_at: clientRecordedAt,
    deleted_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// sortBibsNaturally
// ---------------------------------------------------------------------------

describe('sortBibsNaturally', () => {
  it('sorts numerically so "9" < "10"', () => {
    expect(sortBibsNaturally(['10', '9', '2'])).toEqual(['2', '9', '10']);
  });

  it('handles mixed numeric/non-numeric gracefully', () => {
    const result = sortBibsNaturally(['10', '9a', '2']);
    // '2' should come first, '10' before '9a' or vice-versa — just no crash
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('2');
  });

  it('returns a single element unchanged', () => {
    expect(sortBibsNaturally(['42'])).toEqual(['42']);
  });

  it('returns an empty array unchanged', () => {
    expect(sortBibsNaturally([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeTimeTrialQueue
// ---------------------------------------------------------------------------

const baseEntries: Entry[] = [
  makeEntry({ id: '1', bib: '10', name: 'Alice' }),
  makeEntry({ id: '2', bib: '9',  name: 'Bob' }),
  makeEntry({ id: '3', bib: '2',  name: 'Carol' }),
  makeEntry({ id: '4', bib: '5',  name: 'DNS Rider', status: 'dns' }),
];

describe('computeTimeTrialQueue', () => {
  it('returns ok entries in natural bib order when no crossings', () => {
    const queue = computeTimeTrialQueue([], baseEntries);
    expect(queue.map((r) => r.bib)).toEqual(['2', '9', '10']);
  });

  it('excludes DNS entries', () => {
    const queue = computeTimeTrialQueue([], baseEntries);
    expect(queue.some((r) => r.bib === '5')).toBe(false);
  });

  it('returns empty when all entries have 2 crossings (finished)', () => {
    const t = new Date('2025-01-01T10:00:00Z').getTime();
    const crossings: Crossing[] = [
      makeCrossing('2',  new Date(t).toISOString()),
      makeCrossing('2',  new Date(t + 60_000).toISOString()),
      makeCrossing('9',  new Date(t + 1000).toISOString()),
      makeCrossing('9',  new Date(t + 61_000).toISOString()),
      makeCrossing('10', new Date(t + 2000).toISOString()),
      makeCrossing('10', new Date(t + 62_000).toISOString()),
    ];
    const queue = computeTimeTrialQueue(crossings, baseEntries);
    expect(queue).toHaveLength(0);
  });

  it('excludes entries with 1 crossing (running)', () => {
    const crossings: Crossing[] = [
      makeCrossing('2', new Date().toISOString()),
    ];
    const queue = computeTimeTrialQueue(crossings, baseEntries);
    expect(queue.map((r) => r.bib)).toEqual(['9', '10']);
  });

  it('excludes entries with 2 crossings (finished)', () => {
    const t = new Date().getTime();
    const crossings: Crossing[] = [
      makeCrossing('9', new Date(t).toISOString()),
      makeCrossing('9', new Date(t + 30_000).toISOString()),
    ];
    const queue = computeTimeTrialQueue(crossings, baseEntries);
    expect(queue.map((r) => r.bib)).toEqual(['2', '10']);
  });
});

// ---------------------------------------------------------------------------
// computeTimeTrialResults
// ---------------------------------------------------------------------------

describe('computeTimeTrialResults', () => {
  it('returns empty array when no entries', () => {
    expect(computeTimeTrialResults([], [])).toEqual([]);
  });

  it('returns empty ranked rows when no crossings', () => {
    const results = computeTimeTrialResults([], baseEntries);
    // All ok entries are unranked (queued); DNS entry is in statused
    expect(results.every((r) => r.position === null)).toBe(true);
  });

  it('ranks two finished riders by elapsed time ascending (faster first)', () => {
    const t = new Date('2025-01-01T10:00:00Z').getTime();
    // bib '2': elapsed 55 s → should be P1
    // bib '9': elapsed 60 s → should be P2
    const crossings: Crossing[] = [
      makeCrossing('2', new Date(t).toISOString()),
      makeCrossing('2', new Date(t + 55_000).toISOString()),
      makeCrossing('9', new Date(t).toISOString()),
      makeCrossing('9', new Date(t + 60_000).toISOString()),
    ];
    const results = computeTimeTrialResults(crossings, baseEntries);
    const ranked = results.filter((r) => r.position !== null);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].bib).toBe('2');
    expect(ranked[0].position).toBe(1);
    expect(ranked[1].bib).toBe('9');
    expect(ranked[1].position).toBe(2);
  });

  it('leader gapText is "—" and second is "+N.Ns" format', () => {
    const t = new Date('2025-01-01T10:00:00Z').getTime();
    const crossings: Crossing[] = [
      makeCrossing('2', new Date(t).toISOString()),
      makeCrossing('2', new Date(t + 55_000).toISOString()),
      makeCrossing('9', new Date(t).toISOString()),
      makeCrossing('9', new Date(t + 60_000).toISOString()),
    ];
    const results = computeTimeTrialResults(crossings, baseEntries);
    const ranked = results.filter((r) => r.position !== null);
    expect(ranked[0].gapText).toBe('—');
    expect(ranked[1].gapText).toMatch(/^\+/);
  });

  it('entry with 3 crossings has phase "needs-review" and an elapsedMs', () => {
    const t = new Date('2025-01-01T10:00:00Z').getTime();
    const crossings: Crossing[] = [
      makeCrossing('10', new Date(t).toISOString()),
      makeCrossing('10', new Date(t + 50_000).toISOString()),
      makeCrossing('10', new Date(t + 55_000).toISOString()),
    ];
    const results = computeTimeTrialResults(crossings, baseEntries);
    const row = results.find((r) => r.bib === '10');
    expect(row).toBeDefined();
    expect(row!.phase).toBe('needs-review');
    expect(row!.elapsedMs).toBe(50_000);
  });

  it('DNS entry has position null and appears in results', () => {
    const results = computeTimeTrialResults([], baseEntries);
    const dns = results.find((r) => r.bib === '5');
    expect(dns).toBeDefined();
    expect(dns!.position).toBeNull();
    expect(dns!.status).toBe('dns');
  });
});

// ---------------------------------------------------------------------------
// getProgress
// ---------------------------------------------------------------------------

describe('getProgress', () => {
  it('returns indeterminate when referenceMs is null', () => {
    const result = getProgress(3000, null);
    expect(result).toEqual({ pct: 0, indeterminate: true, overtimeMs: null });
  });

  it('returns indeterminate when referenceMs is 0', () => {
    const result = getProgress(3000, 0);
    expect(result.indeterminate).toBe(true);
  });

  it('returns correct pct when elapsed < reference', () => {
    const result = getProgress(3000, 10_000);
    expect(result).toEqual({ pct: 30, indeterminate: false, overtimeMs: null });
  });

  it('returns pct 100 and positive overtimeMs when elapsed > reference', () => {
    const result = getProgress(12_000, 10_000);
    expect(result).toEqual({ pct: 100, indeterminate: false, overtimeMs: 2000 });
  });

  it('returns pct 100 and overtimeMs 0 when elapsed equals reference', () => {
    const result = getProgress(10_000, 10_000);
    expect(result.pct).toBe(100);
    expect(result.overtimeMs).toBe(0);
  });
});
