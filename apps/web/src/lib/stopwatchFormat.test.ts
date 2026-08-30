import { describe, it, expect } from 'vitest';
import { formatTime, formatLapTime } from './stopwatchFormat';

const HOUR = 3_600_000;
const MINUTE = 60_000;

describe('formatTime', () => {
  it('formats zero', () => {
    expect(formatTime(0)).toEqual({ main: '00:00', sub: '.00' });
  });

  it('formats under a minute', () => {
    expect(formatTime(9_450)).toEqual({ main: '00:09', sub: '.45' });
  });

  it('formats under an hour as MM:SS', () => {
    expect(formatTime(59 * MINUTE + 59_990)).toEqual({
      main: '59:59',
      sub: '.99',
    });
  });

  it('rolls over to H:MM:SS at exactly one hour (#225)', () => {
    expect(formatTime(HOUR)).toEqual({ main: '1:00:00', sub: '.00' });
  });

  it('formats a 75-minute session as 1:15:00, not 75:00 (#225)', () => {
    expect(formatTime(75 * MINUTE)).toEqual({ main: '1:15:00', sub: '.00' });
  });

  it('formats a 4-hour session (#225)', () => {
    expect(formatTime(4 * HOUR + 5 * MINUTE + 6_070)).toEqual({
      main: '4:05:06',
      sub: '.07',
    });
  });
});

describe('formatLapTime', () => {
  it('formats under a minute as S.hh', () => {
    expect(formatLapTime(9_450)).toBe('9.45');
  });

  it('formats under an hour as M:SS.hh', () => {
    expect(formatLapTime(75_230)).toBe('1:15.23');
  });

  it('formats a >1h cumulative value as H:MM:SS.hh (#225)', () => {
    expect(formatLapTime(HOUR + 15 * MINUTE + 23_450)).toBe('1:15:23.45');
  });

  it('formats exactly one hour (#225)', () => {
    expect(formatLapTime(HOUR)).toBe('1:00:00.00');
  });
});
